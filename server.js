import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import rateLimit from 'express-rate-limit';

console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('----------------------------------------');
console.log('🔍 DEBUG: Checking Environment Variables');
console.log('GEMINI_API_KEY present:', !!process.env.GEMINI_API_KEY ? 'YES ✅' : 'NO ❌');
console.log('All Env Keys:', Object.keys(process.env).sort().join(', '));
console.log('----------------------------------------');

dotenv.config({ path: '.env.local' });
console.log('✅ dotenv configured');

const app = express();
const port = process.env.PORT || 3001;
console.log(`🔧 Server will listen on port: ${port}`);

// Enable CORS for frontend domains
app.use(cors({
    origin: [
        'https://lavender-parrot-848521.hostingersite.com',
        'https://gkedgemedia.com',
        'http://localhost:3000'
    ],
    credentials: true
}));
app.use(express.json());
console.log('✅ CORS and middleware configured');

// Rate limiting configuration
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute per IP
    message: { error: "Whoa, we see you're spamming a bit there! Take it easy, you'll be able to message Arky again in a minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 requests per 15 minutes per IP
    message: { error: 'Too many contact form submissions, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

console.log('✅ Rate limiting configured (Chat: 10/min, Contact: 3/15min)');

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
console.log('✅ Gemini AI initialized:', ai ? 'YES' : 'NO (missing API key)');

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'ARKY Backend API',
        version: '1.0.0',
        endpoints: ['/api/chat', '/api/contact'],
        rateLimits: {
            chat: '10 requests per minute',
            contact: '3 requests per 15 minutes'
        }
    });
});

// Chat endpoint with rate limiting
app.post('/api/chat', chatLimiter, async (req, res) => {
    if (!ai) {
        return res.status(500).json({ error: 'Server configuration error: Missing API Key.' });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const model = 'gemini-2.5-flash';
        const response = await ai.models.generateContent({
            model: model,
            contents: message,
            config: {
                systemInstruction: `You are ARKY, an advanced AI agent designed for enterprise business operations.

IMPORTANT: You are currently running in DEMO MODE on our website. Your purpose is to showcase what the full ARKY system can do and help users understand its capabilities.

**ABOUT ARKY & GK EDGE:**
ARKY is created by GK Edge, a company founded in 2023 by Manos Koulouris and Nektarios Georgaklis. 
Contact: info@gkedgemedia.com

**SCOPE RESTRICTION:**
ONLY answer questions about ARKY's capabilities and GK Edge's services. If users ask about unrelated topics, politely redirect them back to discussing ARKY or suggest they contact us at info@gkedgemedia.com for other inquiries.

When users ask you to perform tasks (like web browsing, creating documents, or data analysis), politely explain that you're a demo version here to inform them about ARKY's capabilities, and encourage them to contact our team for the full deployment.

THE FULL ARKY SYSTEM CAPABILITIES:

🌐 **Web Navigation & Automation**
- Autonomous web browsing and data extraction
- Form filling and automated workflows
- Real-time website monitoring and scraping

📊 **Complete Office Suite**
- **Excel/Sheets**: Full-featured spreadsheet UI with cell editing, formulas, styling, charts, and pivot tables
- **Documents**: DOCX creation and editing with rich formatting
- **PDFs**: Professional document generation with custom layouts and embedded assets

🔌 **MCP Connectors (Seamless Integrations)**
The ability to connect with your favorite platforms out of the box:
- Google Workspace (Drive, Sheets, Docs, Gmail)
- Salesforce CRM
- HubSpot
- GitHub
- And many more enterprise tools!

🔒 **Data Privacy & Security**
- Deploy on-premise to your own servers OR secure cloud hosting
- Complete data sovereignty and enterprise-grade security measures
- Enterprise-grade encryption and access controls
(Note: Do NOT claim compliance with GDPR, SOC 2, or ISO 27001 as we are not yet certified)

💻 **Code & App Development**
- Build beautiful, responsive websites from scratch
- Create automation scripts and workflows
- Develop custom integrations and API connections
- Full-stack development capabilities

🛠️ **Adaptive Problem Solving**
When facing tasks outside standard tools, ARKY can:
- Create custom Python tools on-the-fly
- Design bespoke solutions for unique business problems
- Learn and adapt to your specific workflows

YOUR DEMO ROLE:
- Answer questions about ARKY's capabilities enthusiastically
- Provide examples of how ARKY could solve their business problems
- Be helpful, professional, and concise
- Guide interested users to contact our team (info@gkedgemedia.com) for full deployment
- Stay on topic: ARKY and GK Edge only

Keep responses conversational, clear, and under 150 words unless detailed explanation is needed.`,
            }
        });

        res.json({ reply: response.text || "I processed your request but could not generate a text response." });
    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ error: 'Failed to connect to AI service.' });
    }
});

// Email endpoint with rate limiting
import nodemailer from 'nodemailer';

app.post('/api/contact', contactLimiter, async (req, res) => {
    const { firstName, lastName, email, userType, message } = req.body;

    if (!firstName || !email) {
        return res.status(400).json({ error: 'Name and Email are required.' });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.error("SMTP Configuration Error: Missing SMTP_USER or SMTP_PASS");
        return res.status(500).json({ error: 'Server email configuration missing.' });
    }

    try {
        const smtpPort = parseInt(process.env.SMTP_PORT || '587');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        const interestLabel = userType === 'team' ? 'Custom Solution (Enterprise)' : 'ARKY AI Agent (Individual)';

        const mailOptions = {
            from: `"GK Edge Website" <${process.env.SMTP_USER}>`,
            to: 'info@gkedgemedia.com',
            subject: `New Lead: ${firstName} ${lastName} - ${interestLabel}`,
            text: `
New Contact Form Submission

Name: ${firstName} ${lastName}
Email: ${email}
Interest: ${interestLabel}

Message:
${message || 'No additional message provided.'}
            `,
            html: `
                <h2>New Contact Form Submission</h2>
                <p><strong>Name:</strong> ${firstName} ${lastName}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Interest:</strong> ${interestLabel}</p>
                <br/>
                <p><strong>Message:</strong></p>
                <p>${message || 'No additional message provided.'}</p>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to info@gkedgemedia.com from ${email}`);
        res.json({ success: true, message: 'Email sent successfully' });

    } catch (error) {
        console.error("Email Sending Error:", error);
        res.status(500).json({ error: 'Failed to send email. Please try again later.' });
    }
});

console.log('\n🎯 Starting API server...');
app.listen(port, () => {
    console.log('\n========================================');
    console.log('✅ ✅ ✅ API SERVER RUNNING ✅ ✅ ✅');
    console.log('========================================');
    console.log(`🌐 Server listening on port ${port}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log('🛡️  Rate limiting: ACTIVE');
    console.log('========================================\n');
});
