# WhatsApp Group Automation

A local page that creates WhatsApp groups from an Excel sheet, adds the mobile numbers, and posts one welcome message in each group.

It runs on your computer and uses the WhatsApp account you scan in. WhatsApp still decides whether each number can be added.

## What you need

- Windows
- [Node.js 20 or newer](https://nodejs.org/), which includes `npm`
- Google Chrome or Microsoft Edge
- The phone that owns the WhatsApp account, so you can scan a QR code
- This project folder, including `wa-web/.wwebjs_cache/2.3000.1055798384.html`

That HTML file is the WhatsApp page the app loads. Without it, the QR code does not appear.

## Install

1. Install Node.js 20 or newer. If `npm` was installed after this terminal was opened, close the terminal and open a new one. In Cursor, close the app and open it again if a new terminal still cannot find `npm`.

2. Check the tools:

```powershell
node -v
npm -v
```

`node -v` should print `v20` or higher.

3. Install the app packages. Use the full path to this project if you are not already in it. Replace the path below with the folder you copied.

```powershell
cd $env:USERPROFILE\Projects\whatsapp-group-automation\wa-web
npm install
```

`wa-web npm start` is not a command. Change into the `wa-web` folder first, then run `npm`.

## Start

```powershell
cd $env:USERPROFILE\Projects\whatsapp-group-automation\wa-web
npm start
```

Leave that window open. The page is at http://127.0.0.1:3210. Stop the app with Ctrl+C.

## Use it

1. Open http://127.0.0.1:3210 and wait for the QR code.
2. On the phone, open WhatsApp, then **Linked devices**, then **Link a device**, and scan the code.
3. Before or after connecting, choose **Download template** and fill the first worksheet.

| Column | Required | What to enter |
| --- | --- | --- |
| `Name` | Yes | The person's name. Names in one group are joined into `{names}`. |
| `Mobile` | Yes | A 10-digit India mobile, or a full number with a country code such as `+91…`. `Phone` is accepted instead of `Mobile`. |
| `Group` | Yes | The WhatsApp group name. Rows with the same name go into one group. |

A filled sample is in `data/group-members.xlsx`.

4. After the page says **Connected**, upload the sheet.
5. Edit the welcome message if you want. `{group}` becomes the group name. `{names}` becomes the member names.
6. Choose **Preview**, then **Create or update groups**.
7. Choose **Download Excel** for one row per person and the result of each add.

The next time you start the app, the same WhatsApp stays signed in. The login is stored in `wa-web/.wwebjs_auth` and should not be copied to another computer or committed. Choose **Use a different WhatsApp** to scan a new account.

An existing group with the same name is reused, and only new numbers are added. WhatsApp can still refuse a number when it is not on WhatsApp, when that person blocks being added, or when the account is rate-limited. A second group waits and retries, because WhatsApp blocks groups created too close together.

## If it does not start

**`npm` is not recognized.** Node.js is missing from this terminal's PATH. Close the terminal and open a new one. If that still fails, close Cursor completely and open it again.

**`Cannot find path ...\wa-web`.** The terminal is not in the project folder. `cd` to the real `wa-web` folder, then run `npm start`.

**The status says the QR code took too long, or `Waiting failed: 30000ms exceeded`.** Confirm this file exists:

`wa-web/.wwebjs_cache/2.3000.1055798384.html`

Then press Ctrl+C, run `npm start` again, and refresh the page. The server log prints `missing pinned WhatsApp page` when that file is absent.

**Chrome is not found.** Install Google Chrome, or set `CHROME_PATH` to `chrome.exe` before `npm start`:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm start
```

Microsoft Edge in `C:\Program Files\Microsoft\Edge\Application\msedge.exe` is used when Chrome is not installed.

**The page does not open.** Another copy may already be using port 3210. Stop that window with Ctrl+C, then start again.

## Check the sheet logic

From the `wa-web` folder:

```powershell
npm test
```

The tests check phone numbers and how rows are grouped. They do not send WhatsApp messages.

## Optional: Cloud API invites

The commands in `wa_groups` classify numbers and send invite links through the Meta WhatsApp Business Cloud API. That API cannot add members. Each person joins from the invite link.

You need a Cloud API app, an Official Business Account phone number, an access token, a phone-number ID, and an approved group-invite template.

```powershell
cd $env:USERPROFILE\Projects\whatsapp-group-automation
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Put the credentials in `.env`. Leave `DRY_RUN=true` until a preview looks right. The contacts file needs `phone` and `group` columns. `name` is optional. Extra columns such as `city` or `department` can be mapped in `config/groups.yaml`.

```powershell
python -m wa_groups classify --input data/contacts.csv
python -m wa_groups run --input data/contacts.csv
python -m wa_groups run --input data/contacts.csv --live
```

`--live` is refused while `DRY_RUN=true`. Results are written to `output/`: `classified.csv`, `groups.json`, and `invite_log.csv`.
