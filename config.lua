-- whip_bank settings. A shared_script: the client puts the counters on the map and the server checks the player is
-- standing at one from the same list.

Config = {}

-- ---- Language ----
-- A file in locales/ ('en', 'pt', 'es', 'fr', 'de'). A key missing from it falls back to English.
-- The convar wins when set:  setr whip_bank_locale "pt"
Config.Locale = GetConvar('whip_bank_locale', 'pt')

-- ---- Branches ----
-- Each counter is an interaction point. `name` is shown on the screen's header.
-- Config.UseRange (below) is how far the server lets a player be from any counter while the screen is open (they may
-- take a step).
Config.Branches = {
    { name = 'Fleeca · Legion Square',    coords = vector3(149.91, -1040.74, 29.37) },
    { name = 'Fleeca · Hawick',           coords = vector3(314.19, -279.12, 54.17) },
    { name = 'Fleeca · Burton',           coords = vector3(-350.94, -49.97, 49.04) },
    { name = 'Fleeca · Rockford Hills',   coords = vector3(-1212.98, -330.84, 37.79) },
    { name = 'Fleeca · Great Ocean Hwy',  coords = vector3(-2962.58, 482.63, 15.70) },
    { name = 'Fleeca · Route 68',         coords = vector3(1175.06, 2706.64, 38.09) },
    { name = 'Pacific Standard',          coords = vector3(246.64, 223.20, 106.29) },
    { name = 'Blaine County Savings',     coords = vector3(-113.22, 6469.89, 31.63) },
}

Config.UseRange = 10.0

-- ---- Map ----
Config.Blip = {
    show   = true,
    sprite = 108,   -- GTA's dollar sign
    color  = 2,
    scale  = 0.75,
}

-- ---- Screen ----
Config.HistoryLength = 50          -- transactions shown for an account
Config.QuickAmounts  = { 100, 500, 1000, 5000 }
Config.MaxAmount     = 999999999   -- one operation, in dollars

-- ---- Sharing ----
-- Adding someone to an account happens in person: they must be standing this close to you, at the branch, and they
-- say yes on their own screen. Nobody is added by a typed ID.
Config.ShareRange   = 4.0
Config.InviteExpiry = 60           -- seconds they have to answer
