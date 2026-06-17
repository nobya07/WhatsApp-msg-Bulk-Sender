# 📱 WhatsApp Bulk Message Sender

Send personalized WhatsApp messages to a list of contacts from an Excel file. Supports image/PDF attachments, random delays, daily limits, scheduling, and a web UI.

## ⚠️ Important Warning

WhatsApp may ban your account if you send too many messages too quickly. Use this tool responsibly:
- Keep a delay of 3–7 seconds between messages
- Set a daily limit (max 100 recommended)
- Do not send spam or unsolicited messages
- Use a secondary WhatsApp number if possible

## Prerequisites

- [Node.js](https://nodejs.org/) v16 or higher installed
- A WhatsApp account (phone number)
- A smartphone with WhatsApp to scan the QR code

## Installation

```bash
# Navigate to project folder
cd whatsapp-automation

# Install dependencies
npm install
```

## Setup

### 1. Prepare your contacts

Open `contacts.xlsx` in Excel or Google Sheets:
- **Column A**: Phone numbers with country code (e.g., `+919876543210`)
- **Column B**: Names (e.g., `John Doe`)

The script reads all rows starting from row 2 (row 1 is the header).

### 2. Configure settings

Edit `config.js` to set:

| Setting | Description |
|---------|-------------|
| `messageTemplate` | Text with `{{name}}` placeholder for personalization |
| `attachmentPath` | Path to image/PDF file (leave empty `""` for text only) |
| `delayMin` / `delayMax` | Random delay range in milliseconds |
| `dailyLimit` | Max messages per day (`0` = unlimited) |
| `scheduleTime` | Time to send in `HH:MM` format (leave empty to send immediately) |
| `excelFilePath` | Path to your Excel file |

### 3. Add attachments (optional)

Place images or PDFs in the `attachments/` folder and set the path in `config.js`.

## Usage

### CLI Mode

```bash
npm start
```

A QR code will appear in the terminal. Scan it with your WhatsApp phone (Settings → Linked Devices → Link a Device). Messages will be sent automatically.

### Web UI Mode

```bash
npm run web
```

Open `http://localhost:3000` in your browser. Upload contacts, compose your message, optionally attach a file, and click "Start Sending".

## Features

| Feature | Description |
|---------|-------------|
| 🔐 QR Login | Scan QR code to connect your WhatsApp |
| 📊 Excel Import | Read phone numbers and names from `.xlsx` |
| ✨ Personalization | `{{name}}` placeholder replaced per contact |
| 🖼️ Attachments | Optional image or PDF with each message |
| ⏱️ Random Delay | 3–7 second random delay to avoid bans |
| 📋 Daily Limit | Configurable maximum messages per day |
| ✅ Live Status | Sent/Failed indicators in terminal or browser |
| 💾 Crash Recovery | Progress saved after each message |
| 🔄 Auto Retry | Failed numbers are retried once automatically |
| 📄 Report | Excel report generated with Number, Name, Status, Time |
| ⏰ Scheduling | Set a time for daily automatic sending |
| 🌐 Web UI | Upload files, set message, and monitor from browser |

## How Scheduling Works

In `config.js`, set `scheduleTime` to a time like `"10:00"` or `"14:30"`. When you run `npm start`, the script will wait until that time before sending messages. It will send daily at the specified time.

Leave `scheduleTime` empty (`""`) to send immediately.

## Report

After sending, a report Excel file is generated in the `reports/` folder with:
- **Number** — Phone number
- **Name** — Contact name
- **Status** — Sent or Failed
- **Time Sent** — Timestamp of when the message was sent

## Project Structure

```
whatsapp-automation/
├── src/
│   ├── index.js       → Main WhatsApp automation engine
│   ├── web.js         → Express web server with Web UI
│   └── public/
│       └── index.html → Web UI frontend
├── config.js          → All configuration settings
├── contacts.xlsx      → Excel file with phone numbers and names
├── attachments/       → Folder for images/PDFs to attach
├── progress.json      → Auto-created progress file (crash recovery)
├── reports/           → Auto-created report Excel files
├── uploads/           → Uploaded files from web UI
├── package.json
└── README.md
```

## Error Handling

- Invalid phone numbers are skipped
- Failed messages are logged and the script continues
- After all contacts are processed, failed ones are retried once
- WhatsApp disconnection is handled gracefully
- Progress is saved after every successful send

## Troubleshooting

**QR code not appearing?** Ensure you have an internet connection and try again.

**"Client not initialized" error?** Run the script first to generate the QR code and log in.

**Messages not sending?** Verify phone numbers include country code (e.g., `+91`) and the number is registered on WhatsApp.

**WhatsApp disconnected?** Your session may expire. Run the script again to re-link.
