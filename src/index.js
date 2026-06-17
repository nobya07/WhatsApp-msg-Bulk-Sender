const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let client = null;
let isSending = false;
let sendCancelled = false;

// ─────────────────────────────────────────────
// Ensure directories exist
// ─────────────────────────────────────────────
const reportsDir = path.join(__dirname, '..', 'reports');
const progressFile = path.join(__dirname, '..', 'progress.json');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// ─────────────────────────────────────────────
// Load contacts from Excel
// ─────────────────────────────────────────────
function loadContacts(excelPath) {
  const absPath = path.resolve(__dirname, '..', excelPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Excel file not found at ${absPath}`);
  }
  const wb = XLSX.readFile(absPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const phoneCol = config.phoneColumnIndex;
  const nameCol = config.nameColumnIndex;
  const codeCol = config.countryCodeColumnIndex;

  const contacts = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[phoneCol]) continue;
    let number = String(row[phoneCol]).trim();
    // Remove non-digit characters except leading +
    number = number.replace(/[^0-9+]/g, '');
    if (!number) continue;
    // Prepend country code from Column C if number doesn't start with +
    if (!number.startsWith('+')) {
      const code = row[codeCol] ? String(row[codeCol]).trim() : '';
      number = code ? '+' + code + number : number;
    }
    const name = row[nameCol] ? String(row[nameCol]).trim() : 'Valued Customer';
    contacts.push({ number, name });
  }

  return contacts;
}

// ─────────────────────────────────────────────
// Personalize message
// ─────────────────────────────────────────────
function personalizeMessage(template, name) {
  return template.replace(/\{\{name\}\}/g, name);
}

// ─────────────────────────────────────────────
// Save / Load progress
// ─────────────────────────────────────────────
function saveProgress(results) {
  fs.writeFileSync(progressFile, JSON.stringify(results, null, 2));
}

function loadProgress() {
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

function clearProgress() {
  if (fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
  }
}

// ─────────────────────────────────────────────
// Generate report Excel
// ─────────────────────────────────────────────
function generateReport(results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `report-${timestamp}.xlsx`);

  const wsData = [['Number', 'Name', 'Status', 'Time Sent']];
  for (const r of results) {
    wsData.push([r.number, r.name, r.status, r.timeSent || '']);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, reportPath);

  return reportPath;
}

// ─────────────────────────────────────────────
// Random delay
// ─────────────────────────────────────────────
function randomDelay() {
  const ms = Math.floor(Math.random() * (config.delayMax - config.delayMin + 1)) + config.delayMin;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// Send a single message
// ─────────────────────────────────────────────
async function sendMessage(contact, personalizedMsg) {
  const formattedNumber = contact.number.replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '') + '@c.us';

  try {
    if (!client) {
      return { ...contact, status: 'Failed', timeSent: new Date().toISOString(), error: 'Client not initialized' };
    }

    const isRegistered = await client.isRegisteredUser(formattedNumber);
    if (!isRegistered) {
      return { ...contact, status: 'Failed', timeSent: new Date().toISOString(), error: 'Not on WhatsApp' };
    }

    const hasAttachment = config.attachmentPath && config.attachmentPath.trim() !== '';
    if (hasAttachment) {
      const attachAbs = path.resolve(__dirname, '..', config.attachmentPath);
      if (!fs.existsSync(attachAbs)) {
        await client.sendMessage(formattedNumber, personalizedMsg);
      } else {
        const media = MessageMedia.fromFilePath(attachAbs);
        await client.sendMessage(formattedNumber, personalizedMsg, { media });
      }
    } else {
      await client.sendMessage(formattedNumber, personalizedMsg);
    }

    return { ...contact, status: 'Sent', timeSent: new Date().toISOString(), error: null };
  } catch (err) {
    console.error('Send error details:', err);
    return { ...contact, status: 'Failed', timeSent: new Date().toISOString(), error: err.message || String(err) };
  }
}

// ─────────────────────────────────────────────
// Main sending logic
// ─────────────────────────────────────────────
async function run(configOverrides = {}, statusCallback = null) {
  // Merge config overrides (used by web UI)
  const mergedConfig = { ...config, ...configOverrides };

  if (isSending) {
    const msg = 'Already sending messages. Please wait for current session to complete.';
    if (statusCallback) statusCallback({ type: 'error', message: msg });
    throw new Error(msg);
  }

  isSending = true;
  sendCancelled = false;

  // Load contacts
  let contacts;
  try {
    contacts = loadContacts(mergedConfig.excelFilePath);
  } catch (err) {
    isSending = false;
    if (statusCallback) statusCallback({ type: 'error', message: err.message });
    throw err;
  }

  if (contacts.length === 0) {
    isSending = false;
    const msg = 'No contacts found in Excel file.';
    if (statusCallback) statusCallback({ type: 'error', message: msg });
    throw new Error(msg);
  }

  if (statusCallback) statusCallback({ type: 'info', message: `Loaded ${contacts.length} contacts.` });

  // Apply daily limit
  const limit = mergedConfig.dailyLimit > 0 ? mergedConfig.dailyLimit : contacts.length;
  const toSend = contacts.slice(0, limit);

  if (statusCallback) statusCallback({ type: 'info', message: `Will send to ${toSend.length} contacts (daily limit: ${limit}).` });

  // Load previously saved progress
  const saved = loadProgress();
  const progressMap = {};
  for (const s of saved) {
    progressMap[s.number] = s;
  }

  // Determine which contacts still need sending
  const pending = toSend.filter((c) => {
    const prev = progressMap[c.number];
    return !prev || prev.status === 'Failed';
  });

  if (pending.length === 0) {
    const msg = 'All contacts already processed. Clear progress.json to re-send.';
    if (statusCallback) statusCallback({ type: 'info', message: msg });
    isSending = false;
    return;
  }

  if (statusCallback) statusCallback({ type: 'info', message: `Pending: ${pending.length} contacts.` });

  // ─── Ensure WhatsApp client is ready ───
  if (!client) {
    const msg = 'WhatsApp client not initialized. Run script with --qr to generate QR code first.';
    if (statusCallback) statusCallback({ type: 'error', message: msg });
    isSending = false;
    throw new Error(msg);
  }

  // Wait until client is ready
  if (!client.info) {
    if (statusCallback) statusCallback({ type: 'info', message: 'Waiting for WhatsApp client to be ready...' });
    await new Promise((resolve) => {
      const checkReady = setInterval(() => {
        if (client.info) {
          clearInterval(checkReady);
          resolve();
        }
      }, 500);
    });
  }

  if (statusCallback) statusCallback({ type: 'info', message: `WhatsApp connected as ${client.info.pushname || client.info.me?.user || 'unknown'}` });

  // ─── Send messages ───
  const allResults = [...saved];
  const allNumbersDone = new Set();
  for (const r of allResults) {
    allNumbersDone.add(r.number);
  }

  // MultiBar for CLI
  const multiBar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: `{bar} | {percentage}% | {value}/{total} | {status}`,
    },
    cliProgress.Presets.shades_classic
  );

  const progressBar = multiBar.create(pending.length, 0, { status: 'Starting...' });

  let sentCount = 0;
  let failedCount = 0;

  async function processContacts(list) {
    for (let i = 0; i < list.length; i++) {
      if (sendCancelled) {
        if (statusCallback) statusCallback({ type: 'info', message: 'Send cancelled by user.' });
        break;
      }

      const contact = list[i];
      const personalized = personalizeMessage(mergedConfig.messageTemplate, contact.name);

      if (statusCallback) {
        statusCallback({
          type: 'progress',
          current: contact.number,
          name: contact.name,
          sentCount,
          failedCount,
          total: list.length,
          index: i + 1,
        });
      }

      progressBar.update(i + 1, { status: `Sending to ${contact.number} (${contact.name})` });
      console.log(chalk.blue(`\n📨 [${i + 1}/${list.length}] Sending to ${contact.number} (${contact.name})...`));

      const result = await sendMessage(contact, personalized);

      if (result.status === 'Sent') {
        sentCount++;
        console.log(chalk.green(`   ✅ Sent to ${contact.number}`));
      } else {
        failedCount++;
        console.log(chalk.red(`   ❌ Failed - ${contact.number}: ${result.error}`));
      }

      // Save progress
      allResults.push(result);
      saveProgress(allResults);

      // Wait random delay before next (except last)
      if (i < list.length - 1 && !sendCancelled) {
        await randomDelay();
      }
    }
  }

  // First pass
  await processContacts(pending);

  // Retry failed numbers
  const failedNumbers = allResults.filter((r) => r.status === 'Failed' && !allNumbersDone.has(r.number + '_retry'));
  // Mark retried
  for (const f of failedNumbers) {
    allNumbersDone.add(f.number + '_retry');
  }

  if (failedNumbers.length > 0 && !sendCancelled) {
    console.log(chalk.yellow(`\n🔄 Retrying ${failedNumbers.length} failed numbers...`));
    if (statusCallback) statusCallback({ type: 'info', message: `Retrying ${failedNumbers.length} failed numbers...` });

    await processContacts(
      failedNumbers.map((f) => ({ number: f.number, name: f.name }))
    );
  }

  progressBar.stop();
  multiBar.stop();

  // Generate report
  const reportPath = generateReport(allResults);

  const finalMsg = `\n✅ Done! Sent: ${sentCount}, Failed: ${failedCount}, Report: ${reportPath}`;
  console.log(chalk.green(finalMsg));

  if (statusCallback) {
    statusCallback({
      type: 'complete',
      sentCount,
      failedCount,
      reportPath,
      results: allResults,
    });
  }

  // Clear progress after successful completion
  clearProgress();

  isSending = false;
  return { sentCount, failedCount, reportPath, results: allResults };
}

// ─────────────────────────────────────────────
// Initialize WhatsApp client
// ─────────────────────────────────────────────
async function initClient(qrCallback = null, readyCallback = null) {
  return new Promise((resolve, reject) => {
    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '..', '.wwebjs_auth'),
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    });

    client.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
      console.log(chalk.yellow('\n📱 Scan the QR code above with your WhatsApp phone.\n'));
      if (qrCallback) qrCallback(qr);
    });

    client.on('ready', () => {
      console.log(chalk.green('\n✅ WhatsApp client is ready!\n'));
      if (readyCallback) readyCallback(client);
      resolve(client);
    });

    client.on('disconnected', (reason) => {
      console.log(chalk.red(`\n⚠️ WhatsApp disconnected: ${reason}`));
      console.log(chalk.yellow('Re-initialize client to send again.'));
      client = null;
      if (readyCallback) readyCallback(null, reason);
    });

    client.on('auth_failure', (msg) => {
      console.error(chalk.red(`\n❌ Authentication failed: ${msg}`));
      reject(new Error(`Authentication failed: ${msg}`));
    });

    client.initialize();
  });
}

// ─────────────────────────────────────────────
// Schedule mode
// ─────────────────────────────────────────────
function startScheduler(callback) {
  const time = config.scheduleTime;
  if (!time || !time.trim()) {
    console.log(chalk.cyan('⏰ No schedule time set. Sending immediately.'));
    return false;
  }

  const [hour, minute] = time.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute)) {
    console.log(chalk.red(`Invalid schedule time: ${time}. Sending immediately.`));
    return false;
  }

  const cronExpr = `${minute} ${hour} * * *`;
  console.log(chalk.cyan(`⏰ Scheduled to send daily at ${time}. Waiting...`));

  cron.schedule(cronExpr, () => {
    console.log(chalk.cyan(`\n⏰ Scheduled time reached (${time}). Starting send...`));
    run(config, callback).catch((err) => {
      console.error(chalk.red(`Scheduled send failed: ${err.message}`));
    });
  });

  return true;
}

// ─────────────────────────────────────────────
// Main - CLI entry point
// ─────────────────────────────────────────────
async function main() {
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   WhatsApp Bulk Message Sender   ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════╝\n'));

  try {
    await initClient(
      () => {},
      () => {
        const scheduled = startScheduler();
        if (!scheduled) {
          run().catch((err) => {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
          });
        }
      }
    );
  } catch (err) {
    console.error(chalk.red(`Fatal error: ${err.message}`));
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// Export for web server
// ─────────────────────────────────────────────
module.exports = {
  initClient,
  run,
  loadContacts,
  generateReport,
  getClient: () => client,
  isSending: () => isSending,
  cancelSend: () => { sendCancelled = true; },
  clearProgress,
};

// Run if called directly
if (require.main === module) {
  main();
}
