import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const allowedOrigins = [
    'https://gkedgemedia.com',
    'https://gk-edge.com',
    'https://www.gk-edge.com',
    'https://arky-landing-page.onrender.com',
    'http://localhost:3000'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Explicit Preflight
app.options(/(.*)/, cors());
app.use(express.json());
console.log('✅ CORS and middleware configured');

// Rate limiting configuration
const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute per IP
    message: { error: "Whoah, we see you're spamming a bit there! Take it easy, you'll be able to message Arky again in a minute." },
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGEBASE_CANDIDATE_PATHS = [
    path.join(process.cwd(), 'knowledgebase.md'),
    path.join(__dirname, 'knowledgebase.md'),
    path.join(process.cwd(), 'backend', 'knowledgebase.md'),
];

const knowledgebasePath = KNOWLEDGEBASE_CANDIDATE_PATHS.find((candidate) => fs.existsSync(candidate));
const knowledgebaseRaw = knowledgebasePath ? fs.readFileSync(knowledgebasePath, 'utf8') : '';

if (knowledgebasePath) {
    console.log(`✅ Knowledgebase loaded from: ${knowledgebasePath}`);
} else {
    console.warn('⚠️ Knowledgebase not found. Site Copilot will run with limited context.');
}

function normalizeText(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value) {
    return normalizeText(value)
        .split(' ')
        .filter((token) => token.length > 2);
}

function parseKnowledgebaseSections(markdown) {
    if (!markdown.trim()) return [];

    const lines = markdown.split(/\r?\n/);
    const sections = [];
    let currentTitle = 'General Overview';
    let currentLevel = 1;
    let currentLines = [];

    const flushSection = () => {
        const content = currentLines.join('\n').trim();
        if (!content) return;
        sections.push({
            title: currentTitle,
            level: currentLevel,
            content,
            normalizedTitle: normalizeText(currentTitle),
            normalizedContent: normalizeText(content),
        });
    };

    for (const line of lines) {
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushSection();
            currentTitle = heading[2].trim();
            currentLevel = heading[1].length;
            currentLines = [];
            continue;
        }
        currentLines.push(line);
    }

    flushSection();
    return sections;
}

function formatHistory(history) {
    if (!Array.isArray(history)) return '';
    return history
        .slice(-8)
        .map((message) => {
            const role = message?.role === 'assistant' ? 'ARKY' : 'Visitor';
            const content = typeof message?.content === 'string' ? message.content.trim() : '';
            return content ? `${role}: ${content}` : '';
        })
        .filter(Boolean)
        .join('\n');
}

const parsedKnowledgebaseSections = parseKnowledgebaseSections(knowledgebaseRaw);
console.log(`✅ Knowledgebase sections parsed: ${parsedKnowledgebaseSections.length}`);

function getKnowledgeContext(query, limit = 4) {
    if (!parsedKnowledgebaseSections.length) return '';

    const queryTokens = [...new Set(tokenize(query))];

    if (!queryTokens.length) {
        return parsedKnowledgebaseSections
            .slice(0, Math.min(limit, 3))
            .map((section) => `## ${section.title}\n${section.content.slice(0, 1400)}`)
            .join('\n\n');
    }

    const scored = parsedKnowledgebaseSections
        .map((section) => {
            let score = 0;
            for (const token of queryTokens) {
                if (section.normalizedTitle.includes(token)) {
                    score += 6;
                }
                const contentHits = section.normalizedContent.split(token).length - 1;
                score += Math.min(contentHits, 5);
            }
            return { section, score };
        })
        .sort((a, b) => b.score - a.score || a.section.level - b.section.level);

    const relevant = scored.filter((item) => item.score > 0);
    const selected = (relevant.length ? relevant : scored).slice(0, limit);

    return selected
        .map(({ section }) => `## ${section.title}\n${section.content.slice(0, 1400)}`)
        .join('\n\n');
}

const DEMO_SYSTEM_INSTRUCTION = `You are ARKY, an advanced AI agent designed for enterprise business operations.

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

Keep responses conversational, clear, and under 150 words unless detailed explanation is needed.`;

const SITE_COPILOT_SYSTEM_INSTRUCTION = `You are ARKY Site Copilot for gk-edge.com.

Your role is to help visitors navigate the website and understand GK Edge services.

Rules:
- Use only provided knowledgebase context and conversation context.
- Do not invent pricing, certifications, guarantees, or client claims.
- Keep replies concise and practical (2-6 short sentences).
- When suggesting pages, use markdown links with labels (example: [Contact](/contact), [ARKY](/arky)).
- Do not output raw paths alone unless the user explicitly asks for raw URLs.
- If information is missing, say so briefly and suggest contacting info@gkedgemedia.com.`;

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

    const { message, mode = 'demo', history = [] } = req.body;

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const model = 'gemini-3.1-flash-lite-preview';
        const safeMessage = message.trim();
        const chatMode = mode === 'site_copilot' ? 'site_copilot' : 'demo';
        const historyText = formatHistory(history);
        const knowledgeContext = chatMode === 'site_copilot'
            ? getKnowledgeContext(`${safeMessage}\n${historyText}`)
            : '';

        const payload = chatMode === 'site_copilot'
            ? [
                historyText ? `Recent conversation:\n${historyText}` : '',
                knowledgeContext ? `Knowledgebase excerpts:\n${knowledgeContext}` : '',
                `Visitor question: ${safeMessage}`,
            ].filter(Boolean).join('\n\n')
            : safeMessage;

        const response = await ai.models.generateContent({
            model: model,
            contents: payload,
            config: {
                systemInstruction: chatMode === 'site_copilot'
                    ? SITE_COPILOT_SYSTEM_INSTRUCTION
                    : DEMO_SYSTEM_INSTRUCTION,
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
    const { 
        firstName, lastName, email, userType, message, // From Contact.tsx
        name, company, industry, integrations, automation_goal // From RequestDemo.tsx
    } = req.body;

    const contactName = name || (firstName && lastName ? `${firstName} ${lastName}` : firstName);
    const contactEmail = email;

    if (!contactName || !contactEmail) {
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

        // Determine which form was submitted based on the payload
        const isDemoRequest = !!industry;
        
        const subject = isDemoRequest 
            ? `New Demo Request: ${contactName} from ${company || 'Unknown Company'}`
            : `New Lead: ${contactName} - ${userType === 'team' ? 'Custom Solution' : 'ARKY AI Agent'}`;

        const htmlContent = isDemoRequest 
            ? `
                <h2>New Demo Request</h2>
                <p><strong>Name:</strong> ${contactName}</p>
                <p><strong>Email:</strong> ${contactEmail}</p>
                <p><strong>Company:</strong> ${company || 'Not Specified'}</p>
                <p><strong>Industry:</strong> ${industry || 'Not Specified'}</p>
                <p><strong>Integrations:</strong> ${integrations || 'None Selected'}</p>
                <p><strong>Automation Goal:</strong> ${automation_goal || 'Not Specified'}</p>
            `
            : `
                <h2>New Contact Form Submission</h2>
                <p><strong>Name:</strong> ${contactName}</p>
                <p><strong>Email:</strong> ${contactEmail}</p>
                <p><strong>Interest:</strong> ${userType === 'team' ? 'Custom Solution' : 'ARKY AI Agent'}</p>
                <br/>
                <p><strong>Message:</strong></p>
                <p>${message || 'No additional message provided.'}</p>
            `;

        const mailOptions = {
            from: `"GK Edge Website" <${process.env.SMTP_USER}>`,
            to: 'info@gkedgemedia.com',
            subject: subject,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to info@gkedgemedia.com from ${contactEmail}`);
        res.json({ success: true, message: 'Email sent successfully' });

    } catch (error) {
        console.error("Email Sending Error:", error);
        res.status(500).json({ error: 'Failed to send email. Please try again later.' });
    }
});

// --- KEEP ALIVE PING ---
// Render free tier spins down after 15 mins of inactivity.
// Pinging 'localhost' does NOT work because it bypasses Render's router.
// We must ping the exact public URL.
const BACKEND_URL = 'https://arky-backend.onrender.com/';

setInterval(async () => {
    try {
        const res = await fetch(BACKEND_URL);
        console.log(`[Keep-Alive] Pinged self (${BACKEND_URL}). Status: ${res.status}`);
    } catch (err) {
        console.error(`[Keep-Alive] Failed to ping self:`, err.message);
    }
}, 14 * 60 * 1000); // 14 minutes

console.log('\n🎯 Starting API server...');
app.listen(port, () => {
    console.log('\n========================================');
    console.log('✅ ✅ ✅ API SERVER RUNNING ✅ ✅ ✅');
    console.log('========================================');
    console.log(`🌐 Server listening on port ${port}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log('🛡️  Rate limiting: ACTIVE');
    console.log('⚡ Keep-Alive: ACTIVE (14 min interval)');
    console.log('========================================\n');
});
