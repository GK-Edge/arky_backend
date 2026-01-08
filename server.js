import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

console.log('========================================');
console.log('🚀 BACKEND API SERVER STARTING');
console.log('========================================');
console.log('Node version:', process.version);
console.log('Environment:', process.env.NODE_ENV || 'development');

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

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
console.log('✅ Gemini AI initialized:', ai ? 'YES' : 'NO (missing API key)');

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'ARKY Backend API',
        endpoints: ['/api/chat', '/api/contact']
    });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    if (!ai) {
        return res.status(500).json({ error: 'Server configuration error: Missing API Key.' });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const model = 'gemini-3-flash-preview';
        const response = await ai.models.generateContent({
            model: model,
            contents: message,
            config: {
                systemInstruction: "You are ARKY, a helpful and secure AI agent for business operations. Keep responses concise and professional.",
            }
        });

        res.json({ reply: response.text || "I processed your request but could not generate a text response." });
    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ error: 'Failed to connect to AI service.' });
    }
});

// Email endpoint (for reference, not used by current frontend)
import nodemailer from 'nodemailer';

app.post('/api/contact', async (req, res) => {
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
    console.log('========================================\n');
});
