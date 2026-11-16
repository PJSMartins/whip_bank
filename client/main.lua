-- whip_bank client: a prompt at each branch counter, the counter screen (html/), and the answer to someone asking
-- to add you to their account. The page asks for everything through the NUI callbacks below; each one is a
-- whip_bank:* request the server answers (server/main.lua), so nothing the page says is trusted.

local core = exports.whip_core

local open = false
local screen = Whip.padScreen()

-- ============================================
-- The screen
-- ============================================

local function close()
    if not open then return end
    open = false
    screen:close()
    SendNUIMessage({ action = 'close' })
    core:SetScreenOpen(false)
    core:Callback('whip_bank:closed')
end

--- Ask the server, answer the page: { ok = true, data } or { ok = false, error }.
local function ask(name, ...)
    local data, why = core:Callback('whip_bank:' .. name, ...)
    if data == nil or data == false then
        return { ok = false, error = why or L('bank_down') }
    end
    return { ok = true, data = data }
end

local function openScreen()
    if open then return end
    local state = ask('state')
    if not state.ok then
        core:Notify(state.error, 'error', 5000)
        return
    end
    open = true
    SendNUIMessage({
        action = 'open',
        state  = state.data,
        locale = LocaleTable(),
        lang   = LocaleCode(),
        quick  = Config.QuickAmounts,
        pad    = screen:open(),
    })
    core:SetScreenOpen(true)
end

-- Something changed on an account on screen (money arrived, someone joined): the page reads again.
RegisterNetEvent('whip_bank:client:changed', function()
    if open then SendNUIMessage({ action = 'changed' }) end
end)

-- ============================================
-- NUI callbacks (the page's requests)
-- ============================================

local function nui(name, fn)
    RegisterNUICallback(name, function(data, reply)
        if not open then return reply({ ok = false, error = L('not_at_branch') }) end
        data = type(data) == 'table' and data or {}
        reply(fn(data))
    end)
end

RegisterNUICallback('close', function(_, reply)
    reply('ok')
    close()
end)

-- A text field has the keyboard: the pad leaves it alone, and the game gets no input.
RegisterNUICallback('typing', function(data, reply)
    reply('ok')
    if open then screen:typing(type(data) == 'table' and data.on == true) end
end)

nui('state',    function()  return ask('state') end)
nui('history',  function(d) return ask('history', d.id) end)
nui('deposit',  function(d) return ask('deposit', d.id, d.amount, d.note or '') end)
nui('withdraw', function(d) return ask('withdraw', d.id, d.amount, d.note or '') end)
nui('transfer', function(d) return ask('transfer', d.from, d.to or 0, d.number or '', d.amount, d.note or '') end)
nui('open',     function(d) return ask('open', d.label, d.type) end)
nui('closeAccount', function(d) return ask('close', d.id) end)
nui('access',   function(d) return ask('access', d.id) end)
nui('nearby',   function()  return ask('nearby') end)
nui('invite',   function(d) return ask('invite', d.id, d.target, d.role) end)
nui('setRole',  function(d) return ask('setRole', d.id, d.charId, d.role) end)
nui('revoke',   function(d) return ask('revoke', d.id, d.charId) end)

-- ============================================
-- Being asked to join an account
-- ============================================

RegisterNetEvent('whip_bank:client:invite', function(inv)
    if type(inv) ~= 'table' or not inv.token then return end
    CreateThread(function()
        local yes = core:Confirm(inv.title, inv.body, inv.yes, inv.no) == true
        local ok, why = core:Callback('whip_bank:answer', inv.token, yes)
        if not ok and why then core:Notify(why, 'error', 5000) end
    end)
end)

-- ============================================
-- The counters
-- ============================================

Whip.register(function()
    for i, b in ipairs(Config.Branches) do
        local ok, why = core:AddAction({
            id      = 'branch' .. i,
            at      = { coords = b.coords },
            label   = L('open_bank'),
            icon    = 'bank',
            group   = 'bank',
            options = {
                { id = 'use', label = L('open_bank'), icon = 'bank', onSelect = function() openScreen() end },
            },
        })
        if not ok then print(('[whip_bank] could not add the counter at %s: %s'):format(b.name, tostring(why))) end
    end
end)

-- Shot at the counter, or gone to character select: the screen closes.
AddEventHandler('whip_core:player:died', close)
AddEventHandler('whip_core:player:logout', close)

-- Walked away with it open: closed once they are past the server's range.
CreateThread(function()
    while true do
        Wait(1000)
        if open then
            local here = GetEntityCoords(PlayerPedId())
            local near = false
            for _, b in ipairs(Config.Branches) do
                if #(here - b.coords) <= Config.UseRange then near = true break end
            end
            if not near then close() end
        end
    end
end)
