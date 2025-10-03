require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

// ================= Environment Variables =================
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT) || 587;
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true';
const PRINCIPAL_EMAIL = process.env.PRINCIPAL_EMAIL;

// ================= Google Client =================
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ================= MongoDB Model =================
const suggestionSchema = new mongoose.Schema({
  email: String,
  category: String,
  title: String,
  description: String,
  createdAt: { type: Date, default: Date.now },
  departmentHead: String,
  status: { type: String, default: "pending" },
  updatedBy: String,
  hodAlert2Day: { type: Boolean, default: false },
  hodAlert4Day: { type: Boolean, default: false },
  escalated: { type: Boolean, default: false }
});
const Suggestion = mongoose.model('Suggestion', suggestionSchema);

// ================= Department Heads =================
const departmentHeads = {
  academics: process.env.HOD_ACADEMICS,
  facilities: process.env.HOD_FACILITIES,
  "student-life": process.env.HOD_STUDENTLIFE,
  technology: process.env.HOD_TECH,
  safety: process.env.HOD_SAFETY,
  administration: process.env.HOD_ADMINISTRATION,
  other: process.env.HOD_OTHER
};

// ================= Nodemailer =================
const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_SECURE,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});
transporter.verify(err => {
  if (err) console.error("❌ Transporter error:", err);
  else console.log("✅ Transporter ready to send emails");
});

// ================= Google Auth =================
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "No token provided." });

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email;
    if (!email) return res.status(401).json({ error: "Email not found." });

    let isAdmin = false, isPrincipal = false, department = "";

    if (email === PRINCIPAL_EMAIL) {
      isAdmin = true;
      isPrincipal = true;
      department = "Principal";
    } else {
      for (const [dept, headEmail] of Object.entries(departmentHeads)) {
        if (headEmail === email) {
          isAdmin = true;
          department = dept.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
          break;
        }
      }
    }

    res.status(200).json({ email, isAdmin, isPrincipal, department });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Invalid token." });
  }
});

// ================= Submit Suggestion =================
app.post('/api/suggestions', async (req, res) => {
  try {
    const { email, category, title, description } = req.body;
    if (!email) return res.status(401).json({ error: "Email required" });
    if (!category || !departmentHeads[category]) return res.status(400).json({ error: "Invalid category" });

    const departmentHead = departmentHeads[category];
    const suggestion = new Suggestion({ email, category, title, description, departmentHead });
    await suggestion.save();

    transporter.sendMail({
      from: EMAIL_USER,
      to: departmentHead,
      subject: `New Suggestion: ${title}`,
      text: `Category: ${category}\nTitle: ${title}\nDescription: ${description}\nFrom: ${email}`
    }, err => { if (err) console.error("❌ Email error:", err); });

    res.status(201).json({ message: "Suggestion submitted successfully", departmentHead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= Admin Suggestions =================
app.get("/api/admin/suggestions", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    let suggestions = [];

    if (email === PRINCIPAL_EMAIL) {
      suggestions = await Suggestion.find().sort({ createdAt: -1 });
    } else if (Object.values(departmentHeads).includes(email)) {
      const headCategory = Object.keys(departmentHeads).find(k => departmentHeads[k] === email);
      await Suggestion.updateMany(
        { category: headCategory, departmentHead: { $ne: email } },
        { $set: { departmentHead: email } }
      );

      suggestions = await Suggestion.find({ departmentHead: email }).sort({ createdAt: -1 });
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= View Suggestion =================
app.get("/api/admin/suggestions/view/:id", async (req, res) => {
  try {
    const suggestion = await Suggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ error: "Not found" });
    res.json(suggestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/student/suggestions", async (req, res) => {
  const { email } = req.query;
  try {
    const suggestions = await Suggestion.find({ email }).sort({ createdAt: -1 });
    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/student/suggestions/view/:id", async (req, res) => {
  const { id } = req.params;
  const { email } = req.query;

  try {
    const suggestion = await Suggestion.findById(id);
    if (!suggestion) return res.status(404).json({ error: "Not found" });
    if (suggestion.email !== email) return res.status(401).json({ error: "Unauthorized" });
    res.json(suggestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= Update Status =================
app.patch("/api/admin/suggestions/:id", async (req, res) => {
  const { id } = req.params;
  const { status, updatedBy } = req.body;
  if (!["pending","in-progress","resolved","invalid"].includes(status)) return res.status(400).json({ error: "Invalid status" });

  try {
    const suggestion = await Suggestion.findById(id);
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

    suggestion.status = status;
    suggestion.updatedBy = updatedBy;
    await suggestion.save();

    let message = "";
    if (status === "resolved") message = `Hello,\n\nYour suggestion "${suggestion.title}" has been RESOLVED.\n\n- ${updatedBy}`;
    if (status === "invalid") message = `Hello,\n\nYour suggestion "${suggestion.title}" is marked INVALID.\n\n- ${updatedBy}`;

    if (status === "resolved" || status === "invalid") {
      transporter.sendMail({
        from: EMAIL_USER,
        to: suggestion.email,
        subject: `Suggestion Status Update: ${status.toUpperCase()}`,
        text: message
      }, err => { if (err) console.error("❌ Email error:", err); });
    }

    res.json(suggestion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= Delete Suggestion =================
app.delete("/api/student/suggestions/:id", async (req, res) => {
  try {
    await Suggestion.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= Escalation & Reminders =================
const sendEscalationEmails = async () => {
  try {
    const now = new Date();

    // HOD 2nd day reminder
    const hod2Day = await Suggestion.find({
      status: "pending",
      hodAlert2Day: false,
      createdAt: { $lte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) }
    });

    const hodMap2 = {};
    hod2Day.forEach(s => {
      if (!hodMap2[s.departmentHead]) hodMap2[s.departmentHead] = [];
      hodMap2[s.departmentHead].push(s);
    });

    for (const [hodEmail, suggestions] of Object.entries(hodMap2)) {
      const text = suggestions.map((s,i)=>`${i+1}. Title: ${s.title}\nCategory: ${s.category}\nFrom: ${s.email}\nSubmitted: ${s.createdAt}`).join("\n\n");
      transporter.sendMail({
        from: EMAIL_USER,
        to: hodEmail,
        subject: "Reminder: Pending Suggestions (2nd day)",
        text: `Dear HOD,\n\nThe following suggestions are pending for 2 days:\n\n${text}\n\nPlease update status.\n\n- College Portal`
      });
      await Suggestion.updateMany({ _id: { $in: suggestions.map(s=>s._id) } }, { hodAlert2Day: true });
    }

    // HOD 4th day reminder
    const hod4Day = await Suggestion.find({
      status: "pending",
      hodAlert4Day: false,
      createdAt: { $lte: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000) }
    });

    const hodMap4 = {};
    hod4Day.forEach(s => {
      if (!hodMap4[s.departmentHead]) hodMap4[s.departmentHead] = [];
      hodMap4[s.departmentHead].push(s);
    });

    for (const [hodEmail, suggestions] of Object.entries(hodMap4)) {
      const text = suggestions.map((s,i)=>`${i+1}. Title: ${s.title}\nCategory: ${s.category}\nFrom: ${s.email}\nSubmitted: ${s.createdAt}`).join("\n\n");
      transporter.sendMail({
        from: EMAIL_USER,
        to: hodEmail,
        subject: "Reminder: Pending Suggestions (4th day)",
        text: `Dear HOD,\n\nThe following suggestions are pending for 4 days:\n\n${text}\n\nPlease update status.\n\n- College Portal`
      });
      await Suggestion.updateMany({ _id: { $in: suggestions.map(s=>s._id) } }, { hodAlert4Day: true, escalated: true });
    }

  } catch (err) {
    console.error("❌ Escalation error:", err);
  }
};

// Run every hour
setInterval(sendEscalationEmails, 1000 * 60 * 60);

// ================= Connect MongoDB & Start Server =================
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error("❌ MongoDB connection error:", err));
