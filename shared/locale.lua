-- Translations. Each file in locales/ fills Locales['<code>'] with flat keys; L('key', ...) formats one with
-- string.format. A key missing from the chosen language falls back to English, then to the key itself, so a
-- half-translated file never shows a blank.

Locales = Locales or {}

local FALLBACK = 'en'

--- The chosen language's table, or English when the convar/config names one that does not exist.
local function current()
    local code = Config and Config.Locale or FALLBACK
    if not Locales[code] then
        if code ~= FALLBACK then
            print(('[whip_bank] no locale "%s" in locales/, using "%s"'):format(tostring(code), FALLBACK))
        end
        code = FALLBACK
    end
    return Locales[code] or {}, code
end

local active, activeCode = current()
local fallback = Locales[FALLBACK] or {}

---@param key string
---@return string
function L(key, ...)
    local s = active[key] or fallback[key] or key
    if select('#', ...) > 0 then
        local ok, out = pcall(string.format, s, ...)
        if ok then return out end
    end
    return s
end

--- Every key, the chosen language over English: what the page is sent.
---@return table<string, string>
function LocaleTable()
    local out = {}
    for k, v in pairs(fallback) do out[k] = v end
    for k, v in pairs(active) do out[k] = v end
    return out
end

--- The language code in use ('en', 'pt'…), for number formatting on the page.
function LocaleCode() return activeCode end
