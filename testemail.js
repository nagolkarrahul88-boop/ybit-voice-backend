require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

transporter.sendMail({
  from: process.env.EMAIL_USER,
  to: "nagolkarrahul9@gmail.com",
  subject: "Minimal Test Email",
  text: "This is a test"
}, (err, info) => {
  if (err) console.error("❌ Error:", err);
  else console.log("📧 Email sent:", info.response);
});
