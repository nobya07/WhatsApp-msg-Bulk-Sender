module.exports = {
  // Message template - use {{name}} for personalization
  messageTemplate: "Hi {{name}}, here is our special offer! Visit our website for more details.",

  // Optional attachment file path (image or PDF)
  // Leave empty string "" if not needed
  // Example: "./attachments/offer.jpg" or "./attachments/brochure.pdf"
  attachmentPath: "",

  // Random delay range in milliseconds between messages
  // 3000 = 3 seconds, 7000 = 7 seconds
  delayMin: 3000,
  delayMax: 7000,

  // Maximum messages to send per day (0 = unlimited)
  dailyLimit: 100,

  // Schedule time to send messages (24-hour format HH:MM)
  // Leave empty string "" to send immediately
  // Example: "10:00" for 10 AM, "14:30" for 2:30 PM
  scheduleTime: "",

  // Excel file configuration
  excelFilePath: "./contacts.xlsx",
  phoneColumnIndex: 0,  // Column A = phone number (e.g. 9876543210)
  nameColumnIndex: 1,   // Column B = name
  countryCodeColumnIndex: 2,  // Column C = country code (e.g. 91, 1, 44) — leave empty to skip

  // Web server port
  webPort: 3000
};
