-- whip_bank server. The counter's requests (`whip_bank:*`), answered from whip_core's public bank and money exports,
-- called AS THE PLAYER wherever the bank has a rule: what the bank allows here it allows anywhere (the phone, an ATM).
-- This file adds three things whip_core does not have: being at a branch, cash over the counter, and adding someone
-- to an account in person.

local core = exports.whip_core

local RANK = { view = 1, deposit = 2, withdraw = 3, manager = 4, owner = 5 }
local SHAREABLE = { 'view', 'deposit', 'withdraw', 'manager' }

local READ  = { rateLimit = 250, burst = 6 }
local WRITE = { rateLimit = 700, burst = 3 }

-- ============================================
-- Helpers
-- ============================================

--- Where a player stands (whip_core's own read first, the ped as a fallback).
---@return vector3|nil
local function coordsOf(src)
    local c = core:GetPlayerCoords(src)
    if c then return vector3(c.x, c.y, c.z) end
    local ped = GetPlayerPed(src)
    if ped and ped ~= 0 then return GetEntityCoords(ped) end
    return nil
end

--- The branch this player is standing at (its index), or nil.
---@return integer|nil
local function branchOf(src)
    local c = coordsOf(src)
    if not c then return nil end
    for i, b in ipairs(Config.Branches) do
        if #(c - b.coords) <= Config.UseRange then return i end
    end
    return nil
end

--- `false, why` for a player who is not at a counter or has no character.
local function guard(src, player)
    if not player or not player.charId then return false, L('not_loaded') end
    if not branchOf(src) then return false, L('not_at_branch') end
    return true
end

--- Register `whip_bank:<name>`: every handler runs only for a loaded character standing at a branch.
local function cb(name, opts, fn)
    core:SecureCallback('whip_bank:' .. name, opts, function(source, player, ...)
        local ok, why = guard(source, player)
        if not ok then return false, why end
        return fn(source, player, ...)
    end)
end

--- The accounts this character can use, each with their `role`, or nil and why.
local function accountsOf(charId)
    local rows, err = core:GetCharacterBankAccounts(charId)
    if err or type(rows) ~= 'table' then return nil, L('bank_down') end
    return rows
end

--- One of this character's accounts (with their role on it), or nil and why.
local function mine(charId, accountId)
    local rows, why = accountsOf(charId)
    if not rows then return nil, why end
    for _, r in ipairs(rows) do
        if r.accountId == accountId then return r end
    end
    return nil, L('not_your_account')
end

local jobNames = {}
local function jobName(jobId)
    if not jobId then return nil end
    if jobNames[jobId] == nil then
        local job = core:GetJob(jobId)
        jobNames[jobId] = job and job.name or false
    end
    return jobNames[jobId] or nil
end
AddEventHandler('whip_core:job:updated', function(e) if type(e) == 'table' then jobNames[e.jobId] = nil end end)

--- May the owner close this account here? (whip_core asks again in CloseBankAccount.)
local function closable(r)
    return r.role == 'owner' and r.isDefault ~= true and not r.jobId and (r.type == 'savings' or r.type == 'shared')
end

--- An account the way the page shows it, with what this player may do on it.
local function summary(r)
    local rank = RANK[r.role] or 0
    return {
        id = r.accountId, number = r.accountNumber, label = r.label, type = r.type,
        balance = tonumber(r.balance) or 0, role = r.role, default = r.isDefault == true,
        frozen = r.frozen == true, job = jobName(r.jobId),
        can = {
            deposit  = rank >= RANK.deposit,
            withdraw = rank >= RANK.withdraw,
            transfer = rank >= RANK.withdraw,
            share    = rank >= RANK.manager,
            close    = closable(r),
        },
    }
end

--- A line of text from the page: control characters out, trimmed, at most `max` bytes, whole characters.
local function text(v, max)
    if type(v) ~= 'string' then return '' end
    v = v:gsub('[%z\1-\31]', ''):gsub('^%s+', ''):gsub('%s+$', '')
    if #v > max then v = v:sub(1, max):gsub('[\192-\255][\128-\191]*$', '') end
    return v
end

--- 'WB-123456', '123456' or ' wb 123456 ' → 'WB-123456', or nil.
local function accountNumber(v)
    local n = text(tostring(v or ''), 16):upper():gsub('%s', '')
    if n:match('^%d%d%d%d%d%d$') then n = 'WB-' .. n end
    if n:match('^WB%d%d%d%d%d%d$') then n = 'WB-' .. n:sub(3) end
    return n:match('^WB%-%d%d%d%d%d%d$') and n or nil
end

-- ============================================
-- Live: an open counter screen hears about its accounts
-- ============================================

--- [source] = { [accountId] = true } while their counter screen is open.
local watching = {}

AddEventHandler('playerDropped', function() watching[source] = nil end)

local function pushChanged(ids)
    for src, seen in pairs(watching) do
        for _, id in ipairs(ids) do
            if seen[id] then
                TriggerClientEvent('whip_bank:client:changed', src)
                break
            end
        end
    end
end

AddEventHandler('whip_core:bank:balanceChanged', function(e)
    if type(e) ~= 'table' then return end
    local ids = {}
    for _, k in ipairs({ 'accountId', 'fromAccountId', 'toAccountId' }) do
        if e[k] then ids[#ids + 1] = e[k] end
    end
    pushChanged(ids)
end)

AddEventHandler('whip_core:bank:accountChanged', function(e)
    if type(e) == 'table' and e.accountId then pushChanged({ e.accountId }) end
end)

-- ============================================
-- In-person sharing
-- ============================================
--
-- Adding someone is a request they answer on their own screen, and they must be standing next to the person asking,
-- at a branch. Nobody is put on an account by a typed ID. Kept in memory: gone after Config.InviteExpiry.

--- [token] = { accountId, label, role, fromSrc, fromCharId, fromName, toSrc, toCharId, toName, at }
local invites, inviteSeq = {}, 0

local function prune()
    local now = os.time()
    for token, inv in pairs(invites) do
        if now - inv.at > Config.InviteExpiry then invites[token] = nil end
    end
end

--- The name this player may see for another, or the neutral one.
local function nameFor(viewer, target)
    if core:CanSeePlayerName(viewer, target) then
        return core:GetPlayerFullName(target) or L('someone')
    end
    return L('stranger')
end

--- Players standing within Config.ShareRange of `src`, with a character loaded.
local function nearby(src)
    local me = coordsOf(src)
    if not me then return {} end
    local out = {}
    for _, s in ipairs(GetPlayers()) do
        local other = tonumber(s)
        if other and other ~= src and core:GetCharId(other) then
            local c = coordsOf(other)
            local d = c and #(me - c)
            if d and d <= Config.ShareRange then
                out[#out + 1] = { src = other, name = nameFor(src, other), dist = math.floor(d * 10 + 0.5) / 10 }
            end
        end
    end
    table.sort(out, function(a, b) return a.dist < b.dist end)
    return out
end

-- ============================================
-- Requests
-- ============================================

Whip.register(function()
    -- -> { accounts = { summary… }, cash, branch, quick }
    cb('state', READ, function(source, player)
        local rows, why = accountsOf(player.charId)
        if not rows then return false, why end
        local out, seen = {}, {}
        for i, r in ipairs(rows) do
            out[i] = summary(r)
            seen[r.accountId] = true
        end
        watching[source] = seen
        local b = Config.Branches[branchOf(source) or 1]
        return { accounts = out, cash = core:GetPlayerCash(source) or 0, branch = b and b.name or '' }
    end)

    -- The screen closed: no more live pushes. Answered wherever they are.
    core:SecureCallback('whip_bank:closed', READ, function(source)
        watching[source] = nil
        return true
    end)

    -- (accountId) -> { { id, amount, dir, kind, text, party, time, balance }, ... } newest first
    cb('history', { rateLimit = 250, burst = 6, params = { { 'accountId', 'id' } } }, function(_, player, accountId)
        local r, why = mine(player.charId, accountId)
        if not r then return false, why end
        local rows = core:GetBankTransactions(accountId, Config.HistoryLength, 0) or {}
        -- The other side of a transfer is named only when no person owns it (a business, a lore account).
        local named = {}
        local function partyOf(otherId)
            if not otherId or otherId == accountId then return nil end
            if named[otherId] == nil then
                local acc = core:GetBankAccount(otherId)
                named[otherId] = (acc and acc.ownerCharId == nil and type(acc.label) == 'string') and acc.label or false
            end
            return named[otherId] or nil
        end
        local out = {}
        for i, t in ipairs(rows) do
            local isOut = t.fromAccountId == accountId and t.toAccountId ~= accountId
            local kind = t.type
            if kind == 'transfer' then kind = isOut and 'transfer_out' or 'transfer_in' end
            out[i] = {
                id = t.txId, amount = tonumber(t.amount) or 0, dir = isOut and 'out' or 'in', kind = kind,
                text = (type(t.message) == 'string' and t.message ~= '') and t.message or nil,
                party = t.type == 'transfer' and partyOf(isOut and t.toAccountId or t.fromAccountId) or nil,
                time = t.createdAt, balance = tonumber(isOut and t.fromBalance or t.toBalance),
            }
        end
        return out
    end)

    -- (accountId, amount, note) -> true. Cash from the pockets into the account; the cash is put back if the bank
    -- refuses.
    cb('deposit', { rateLimit = 700, burst = 3, params = {
        { 'accountId', 'id' }, { 'amount', 'amount', Config.MaxAmount }, { 'note', 'string', 100, '' },
    } }, function(source, player, accountId, amount, note)
        local r, why = mine(player.charId, accountId)
        if not r then return false, why end
        if r.frozen then return false, L('account_frozen') end
        if (RANK[r.role] or 0) < RANK.deposit then return false, L('no_permission') end

        local reason = text(note, 100)
        if reason == '' then reason = L('reason_deposit') end

        local receipt, payErr = core:ChargePlayer(source, amount, { method = 'cash', reason = reason })
        if not receipt then return false, payErr or L('deposit_failed') end

        local ok, err = core:BankDeposit(accountId, amount, source, { reason = reason })
        if not ok then
            local back, backErr = core:RefundPlayer(receipt)
            if not back then
                print(('[whip_bank] CRITICAL: a failed $%d deposit could not give the cash back to charId %s: %s')
                    :format(amount, tostring(player.charId), tostring(backErr)))
                return false, L('cash_failed_admin')
            end
            return false, err or L('deposit_failed')
        end
        return true
    end)

    -- (accountId, amount, note) -> true. The account into the pockets. Room is checked first; if the cash can not
    -- be handed over after the debit, the account gets it back.
    cb('withdraw', { rateLimit = 700, burst = 3, params = {
        { 'accountId', 'id' }, { 'amount', 'amount', Config.MaxAmount }, { 'note', 'string', 100, '' },
    } }, function(source, player, accountId, amount, note)
        local r, why = mine(player.charId, accountId)
        if not r then return false, why end
        if r.frozen then return false, L('account_frozen') end
        if (RANK[r.role] or 0) < RANK.withdraw then return false, L('no_permission') end
        if not core:CanFitItem(source, 'cash', amount) then return false, L('no_room_cash') end

        local reason = text(note, 100)
        if reason == '' then reason = L('reason_withdraw') end

        local ok, err = core:BankWithdraw(accountId, amount, source, { reason = reason })
        if not ok then return false, err or L('withdraw_failed') end

        local paid = core:PayPlayer(source, amount, { method = 'cash', reason = reason })
        if not paid then
            local back, backErr = core:BankSystemDeposit(accountId, amount,
                { reason = L('reason_refund'), actorCharId = player.charId })
            if not back then
                print(('[whip_bank] CRITICAL: $%d left account #%d for charId %s but neither the cash nor the refund landed: %s')
                    :format(amount, accountId, tostring(player.charId), tostring(backErr)))
                return false, L('cash_failed_admin')
            end
            return false, L('cash_failed')
        end
        return true
    end)

    -- (fromId, toId|0, number|'', amount, note) -> true. To one of their own accounts (toId) or any account by number.
    cb('transfer', { rateLimit = 700, burst = 3, params = {
        { 'fromId', 'id' }, { 'toId', 'int', 0, 2147483647, 0 }, { 'number', 'string', 16, '' },
        { 'amount', 'amount', Config.MaxAmount }, { 'note', 'string', 100, '' },
    } }, function(source, player, fromId, toId, number, amount, note)
        local r, why = mine(player.charId, fromId)
        if not r then return false, L('pick_from') end
        if r.frozen then return false, L('account_frozen') end
        if (RANK[r.role] or 0) < RANK.withdraw then return false, L('no_permission') end

        local to
        if number ~= '' then
            local n = accountNumber(number)
            if not n then return false, L('account_format') end
            local acc = core:GetBankAccount({ number = n })
            if not acc then return false, L('account_missing', n) end
            to = acc.accountId
        else
            local target = toId > 0 and mine(player.charId, toId)
            if not target then return false, L('not_your_account') end
            to = toId
        end
        if to == fromId then return false, L('same_account') end

        local reason = text(note, 100)
        if reason == '' then reason = L('reason_transfer') end
        local ok, err = core:BankTransfer(fromId, to, amount, source, { reason = reason })
        if not ok then return false, err or L('transfer_failed') end
        return true
    end)

    -- (label, type) -> { id, number }
    cb('open', { rateLimit = 2000, params = {
        { 'label', 'string', 50, '' }, { 'type', 'enum', { 'savings', 'shared' } },
    } }, function(source, _, label, kind)
        label = text(label, 50)
        if label == '' then return false, L('name_account') end
        local acc, why = core:CreateBankAccount(source, label, { type = kind })
        if not acc then return false, why or L('bank_refused') end
        return { id = acc.accountId, number = acc.accountNumber }
    end)

    -- (accountId) -> true. The owner, an empty savings or shared account (whip_core checks).
    cb('close', { rateLimit = 2000, params = { { 'accountId', 'id' } } }, function(source, _, accountId)
        local ok, why = core:CloseBankAccount(accountId, source)
        if not ok then return false, why or L('bank_refused') end
        return true
    end)

    -- (accountId) -> { people = { { charId, name, role, me, editable } }, pending = { { token, name, role } } }
    cb('access', { rateLimit = 250, burst = 6, params = { { 'accountId', 'id' } } }, function(_, player, accountId)
        local r, why = mine(player.charId, accountId)
        if not r then return false, why end
        local myRank = RANK[r.role] or 0
        if myRank < RANK.manager then return false, L('managers_only') end
        local rows = core:GetBankAccessList(accountId)
        if type(rows) ~= 'table' then return false, L('bank_down') end
        local ids = {}
        for i, a in ipairs(rows) do ids[i] = a.charId end
        local names = core:GetCharacterNames(ids) or {}
        local people = {}
        for i, a in ipairs(rows) do
            local me = a.charId == player.charId
            people[i] = {
                charId = a.charId, name = names[a.charId] or ('#' .. a.charId), role = a.role, me = me,
                editable = not me and a.role ~= 'owner' and (RANK[a.role] or 0) < myRank,
            }
        end
        table.sort(people, function(a, b)
            local ra, rb = RANK[a.role] or 0, RANK[b.role] or 0
            if ra ~= rb then return ra > rb end
            return a.name < b.name
        end)
        prune()
        local pending = {}
        for token, inv in pairs(invites) do
            if inv.accountId == accountId then
                pending[#pending + 1] = { token = token, name = inv.toName, role = inv.role }
            end
        end
        local roles = {}
        for _, role in ipairs(SHAREABLE) do
            if RANK[role] < myRank then roles[#roles + 1] = role end
        end
        return { people = people, pending = pending, roles = roles }
    end)

    -- () -> { { src, name, dist } }: who is standing next to this player
    cb('nearby', READ, function(source)
        return nearby(source)
    end)

    -- (accountId, target src, role) -> { name }. Asks the person next to you; they answer on their own screen.
    cb('invite', { rateLimit = 1500, burst = 2, params = {
        { 'accountId', 'id' }, { 'target', 'id' }, { 'role', 'enum', SHAREABLE },
    } }, function(source, player, accountId, target, role)
        local r, why = mine(player.charId, accountId)
        if not r then return false, why end
        if (RANK[r.role] or 0) < RANK.manager then return false, L('managers_only') end
        if RANK[role] >= (RANK[r.role] or 0) then return false, L('role_too_high') end

        local toCharId = core:GetCharId(target)
        if not toCharId then return false, L('not_nearby') end
        if toCharId == player.charId then return false, L('thats_you') end
        local here, there = coordsOf(source), coordsOf(target)
        if not here or not there or #(here - there) > Config.ShareRange or not branchOf(target) then
            return false, L('not_nearby')
        end

        for _, a in ipairs(core:GetBankAccessList(accountId) or {}) do
            if a.charId == toCharId then return false, L('already_on') end
        end
        prune()
        for _, inv in pairs(invites) do
            if inv.accountId == accountId and inv.toCharId == toCharId then return false, L('invite_pending') end
        end

        -- The bank's own rules now, and again when they say yes.
        local may, mayWhy = core:CanGrantBankAccess(accountId, { charId = toCharId }, role, source)
        if not may then return false, mayWhy or L('bank_refused') end

        inviteSeq = inviteSeq + 1
        local token = inviteSeq
        local toName = nameFor(source, target)
        invites[token] = {
            accountId = accountId, label = r.label, role = role,
            fromSrc = source, fromCharId = player.charId, fromName = nameFor(target, source),
            toSrc = target, toCharId = toCharId, toName = toName, at = os.time(),
        }
        TriggerClientEvent('whip_bank:client:invite', target, {
            token = token,
            title = L('invite_title'),
            body  = L('invite_body', invites[token].fromName, L('role_' .. role), r.label),
            yes   = L('invite_yes'),
            no    = L('invite_no'),
        })
        return { name = toName }
    end)

    -- (accountId, charId, role) -> true. Change what someone already on the account may do.
    cb('setRole', { rateLimit = 700, burst = 3, params = {
        { 'accountId', 'id' }, { 'charId', 'id' }, { 'role', 'enum', SHAREABLE },
    } }, function(source, player, accountId, charId, role)
        if charId == player.charId then return false, L('thats_you') end
        local ok, why = core:GrantBankAccess(accountId, { charId = charId }, role, source)
        if not ok then return false, why or L('bank_refused') end
        return true
    end)

    -- (accountId, charId) -> true
    cb('revoke', { rateLimit = 700, burst = 3, params = { { 'accountId', 'id' }, { 'charId', 'id' } } },
        function(source, player, accountId, charId)
            if charId == player.charId then return false, L('thats_you') end
            local ok, why = core:RevokeBankAccess(accountId, { charId = charId }, source)
            if not ok then return false, why or L('bank_refused') end
            return true
        end)

    -- The invited player's answer: (token, yes). Not behind the branch guard's message: they are at the counter
    -- (checked when it was sent and again here), but the answer must reach the asker either way.
    core:SecureCallback('whip_bank:answer', { rateLimit = 500, burst = 3, params = {
        { 'token', 'id' }, { 'yes', 'bool', false },
    } }, function(source, player, token, yes)
        prune()
        local inv = invites[token]
        if not inv or not player or inv.toCharId ~= player.charId or inv.toSrc ~= source then
            return false, L('invite_expired')
        end
        invites[token] = nil

        if not yes then
            core:NotifyPlayer(inv.fromSrc, L('invite_declined', inv.toName), 'warning')
            TriggerClientEvent('whip_bank:client:changed', inv.fromSrc)
            return true
        end

        local here, there = coordsOf(source), coordsOf(inv.fromSrc)
        if not here or not there or #(here - there) > Config.ShareRange then
            core:NotifyPlayer(inv.fromSrc, L('not_nearby'), 'error')
            return false, L('not_nearby')
        end

        local ok, why = core:GrantBankAccess(inv.accountId, { charId = inv.toCharId }, inv.role,
            { charId = inv.fromCharId })
        if not ok then
            core:NotifyPlayer(inv.fromSrc, why or L('bank_refused'), 'error')
            return false, why or L('bank_refused')
        end
        core:NotifyPlayer(inv.fromSrc, L('invite_accepted', inv.toName, inv.label), 'success')
        core:NotifyPlayer(source, L('invite_joined', inv.label), 'success')
        TriggerClientEvent('whip_bank:client:changed', inv.fromSrc)
        return true
    end)

    -- The branches on everyone's map.
    if Config.Blip and Config.Blip.show then
        for i, b in ipairs(Config.Branches) do
            local ok, why = core:ShowBlip('everyone', 'branch' .. i, {
                coords = b.coords, label = L('blip_label'), sprite = Config.Blip.sprite,
                color = Config.Blip.color, scale = Config.Blip.scale, shortRange = true,
            })
            if not ok then print(('[whip_bank] no blip for %s: %s'):format(b.name, tostring(why))) end
        end
    end
end)
