fx_version 'cerulean'
game 'gta5'

name 'whip_bank'
author 'PM Labs'
description 'Bank branches: a teller counter for whip_core accounts (deposit, withdraw, transfer, open, close, sharing)'
version '1.0.0'

-- A whip satellite: every rule about money and accounts is whip_core's. This resource only adds the branches, the
-- counter screen and the in-person sharing. ATMs are whip_core's own and are not touched here.

shared_scripts {
    '@whip_core/lib/satellite.lua',
    'config.lua',
    'locales/*.lua',
    'shared/locale.lua',
}

client_script 'client/main.lua'
server_script 'server/main.lua'

ui_page 'html/index.html'

-- Only this resource's page may call its NUI callbacks (they move money).
nui_callback_strict_mode 'true'

files {
    'html/index.html',
    'html/css/bank.css',
    'html/js/bank.js',
}

dependency 'whip_core'

lua54 'yes'
