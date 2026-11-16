# whip_bank

Bank branches for WHIP. Walk up to a bank counter and open a screen with all your accounts: see the balance and the
recent activity, deposit and withdraw cash, transfer money, open and close accounts, and choose who else can use an
account. ATMs are not part of this resource: whip_core has its own.

- **Needs:** a recent whip_core (see *whip_core exports used* below) and oxmysql, which whip_core already uses.
- **Install:** put the folder in `resources/whip_bank` and add `ensure whip_bank` to server.cfg, after
  `ensure whip_core`. No SQL: it uses whip_core's own bank tables.
- **Language:** `Config.Locale` in `config.lua`, or the convar `setr whip_bank_locale "en"`. Included: English (`en`),
  Portuguese (`pt`), Spanish (`es`), French (`fr`) and German (`de`). The shipped config uses `pt`.

## What a player can do

At any counter in `Config.Branches` (the eight Fleeca, Pacific Standard and Blaine County branches by default):

- **Deposit:** cash from their pockets into an account. If the bank refuses, the cash is given back.
- **Withdraw:** money from an account into their pockets. Room for the cash is checked first. If the cash can not be
  handed over after the debit, the account gets the money back.
- **Transfer:** to another of their own accounts, or to any account by its number (`WB-000000`). A confirmation shows
  first.
- **Open an account:** savings or shared. whip_core's limit on extra accounts applies.
- **Close an account:** the owner of an empty savings or shared account.
- **Access:** the owner and managers see who uses the account, change what each person may do, and remove people.

Every rule about money and accounts is whip_core's: permissions (view, deposit, withdraw, manager, owner), frozen
accounts and the overdraft guard. whip_bank asks whip_core as the player, so what the bank allows here it allows on the
phone and at an ATM too.

## Adding someone to an account

It happens in person. The other player must be standing next to you (`Config.ShareRange`) at a bank, and they accept
or decline on their own screen. Nobody can be added by typing an ID. You can only give access below your own role.

## Settings (`config.lua`)

| Setting | What it does |
| --- | --- |
| `Config.Locale` | The language file in `locales/` |
| `Config.Branches` | The counters: a `name` (shown on the screen) and `coords` |
| `Config.UseRange` | How far from a counter the screen keeps working |
| `Config.Blip` | The map icon (`show = false` hides it) |
| `Config.HistoryLength` | How many transactions an account shows |
| `Config.QuickAmounts` | The four quick-amount buttons |
| `Config.MaxAmount` | The largest single operation, in dollars |
| `Config.ShareRange` | How close a person must stand to be added |
| `Config.InviteExpiry` | Seconds they have to answer |

## Controls

↑ ↓ change account, Tab changes operation, Enter confirms, Esc leaves. A controller works too (D-pad, A, B).

## Adding a language

Copy `locales/en.lua` to `locales/<code>.lua`, change `Locales['en']` to `Locales['<code>']`, and translate the
values. Leave the keys as they are. A key you leave out shows in English.

## whip_core exports used

Server: `SecureCallback`, `GetCharacterBankAccounts`, `GetBankAccount`, `GetBankTransactions`, `GetBankAccessList`,
`CreateBankAccount`, `CloseBankAccount`, `BankDeposit`, `BankWithdraw`, `BankTransfer`, `BankSystemDeposit`,
`GrantBankAccess`, `CanGrantBankAccess`, `RevokeBankAccess`, `ChargePlayer`, `RefundPlayer`, `PayPlayer`,
`GetPlayerCash`, `CanFitItem`, `GetPlayerCoords`, `GetCharId`, `GetCharacterNames`, `GetPlayerFullName`,
`CanSeePlayerName`, `GetJob`, `NotifyPlayer`, `ShowBlip`.

Client: `Callback`, `AddAction`, `SetScreenOpen`, `Notify`, `Confirm`, and `Whip.register` / `Whip.padScreen` from
`@whip_core/lib/satellite.lua`.

If whip_core is older than one of these, the console shows the missing export when the resource starts or when that
action is used.

## License

whip_bank is licensed under the GNU LGPL 3.0; see `COPYING.LESSER`, and `COPYING` for the GPL 3.0 it builds on.
`NOTICE.md` says what the licence doesn't cover; whip_core's `NOTICE.md` is the full list.
