import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import rateLimit from 'express-rate-limit';
import { Resend } from 'resend';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadKnowledgeBase } from './knowledge.js';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

// Look for .env.local in the root project folder (one level up from backend/)
dotenv.config({ path: path.join(__dirname_local, '..', '.env.local') });
console.log('✅ dotenv configured');

console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('----------------------------------------');
console.log('🔍 DEBUG: Checking Environment Variables');
console.log('GEMINI_API_KEY present:', !!process.env.GEMINI_API_KEY ? 'YES ✅' : 'NO ❌');
console.log('All Env Keys:', Object.keys(process.env).sort().join(', '));
console.log('----------------------------------------');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Render)
const port = process.env.PORT || 3001;
console.log(`🔧 Server will listen on port: ${port}`);

// Enable CORS for frontend domains
const allowedOrigins = [
    'https://gkedgemedia.com',
    'https://gk-edge.com',
    'https://www.gk-edge.com',
    'https://arky-landing-page.onrender.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173'
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
    skip: (req) => {
        const origin = req.get('origin') || '';
        return origin.includes('localhost');
    },
});

const contactLimiter = rateLimit({
    windowMs: 3 * 60 * 1000, // 3 minutes
    max: 3, // 3 requests per 3 minutes per IP
    message: { error: 'Too many contact form submissions, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const origin = req.get('origin') || '';
        return origin.includes('localhost');
    },
});

console.log('✅ Rate limiting configured (Chat: 10/min, Contact: 3/15min)');

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
console.log('✅ Gemini AI initialized:', ai ? 'YES' : 'NO (missing API key)');

const { file: knowledgebasePath, base: knowledge } = loadKnowledgeBase(__dirname_local);

if (knowledgebasePath) {
    const { sections, characters, mode } = knowledge.describe();
    console.log(`✅ Knowledgebase loaded from ${knowledgebasePath}: ${sections} sections, ${characters} characters, ${mode} mode`);
} else {
    console.warn('⚠️ Knowledgebase not found. ARKY will run with limited context.');
}

/** How much of a conversation and a question ARKY will take in, so one visitor cannot run up a bill. */
const LIMITS = { message: 2000, historyTurns: 8, historyChars: 1200, replyTimeoutMs: 45000 };

/**
 * Names the language to answer in. The knowledgebase is mostly English but carries a Greek glossary, and a model reading
 * it will otherwise answer an English question in Greek. Counting the letters of each script settles it.
 */
function languageDirective(message) {
    const greek = (message.match(/\p{Script=Greek}/gu) || []).length;
    const latin = (message.match(/\p{Script=Latin}/gu) || []).length;
    if (greek > latin) return 'Reply in Greek. Use /el links.';
    if (latin > 0 && greek === 0) return 'Reply in English. Use links without a language prefix.';
    return "Reply in the language of the visitor question below, whichever that is.";
}

function formatHistory(history) {
    if (!Array.isArray(history)) return '';
    return history
        .slice(-LIMITS.historyTurns)
        .map((message) => {
            const role = message?.role === 'assistant' ? 'ARKY' : 'Visitor';
            const content = typeof message?.content === 'string' ? message.content.trim().slice(0, LIMITS.historyChars) : '';
            return content ? `${role}: ${content}` : '';
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * Turns a request body into everything the model call needs, or an error to send back. Both chat routes go through here
 * so the streaming and non-streaming answers are built from identical context.
 */
function prepareChat(body) {
    const { message, mode = 'demo', history = [] } = body ?? {};

    if (typeof message !== 'string' || !message.trim()) {
        return { error: { status: 400, code: 'message_required', message: 'Message is required.' } };
    }
    if (message.length > LIMITS.message) {
        return { error: { status: 413, code: 'message_too_long', message: `Please keep your question under ${LIMITS.message} characters.` } };
    }

    const chatMode = mode === 'site_copilot' ? 'site_copilot' : 'demo';
    const safeMessage = message.trim();
    const historyText = formatHistory(history);
    // Retrieval reads the question first and the conversation second, so an old topic cannot outvote the current one.
    const { text: knowledgeContext, headings } = knowledge.context(`${safeMessage} ${safeMessage} ${historyText}`);

    const contents = [
        languageDirective(safeMessage),
        historyText ? `Recent conversation:\n${historyText}` : '',
        knowledgeContext ? `Knowledgebase:\n${knowledgeContext}` : '',
        `Visitor question: ${safeMessage}`,
    ].filter(Boolean).join('\n\n');

    return {
        contents,
        headings,
        config: {
            systemInstruction: chatMode === 'site_copilot' ? SITE_COPILOT_SYSTEM_INSTRUCTION : DEMO_SYSTEM_INSTRUCTION,
        },
    };
}

const DEMO_SYSTEM_INSTRUCTION = `You are ARKY, an advanced AI agent designed for enterprise business operations.

IMPORTANT: You are currently running in DEMO MODE on our website. Your purpose is to showcase what the full ARKY system can do and help users understand its capabilities.

**ABOUT ARKY & GK EDGE:**
ARKY is created by GK Edge, a company founded in 2023 by Manos Koulouris and Nektarios Georgaklis. 
Contact: info@gk-edge.com

**SCOPE RESTRICTION:**
ONLY answer questions about ARKY's capabilities and GK Edge's services. If users ask about unrelated topics, politely redirect them back to discussing ARKY or suggest they contact us at info@gk-edge.com for other inquiries.

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
- Guide interested users to contact our team (info@gk-edge.com) for full deployment
- Stay on topic: ARKY and GK Edge only

LANGUAGE:
Answer in the visitor's own language. If they write in Greek, reply in Greek.

Keep responses conversational, clear, and under 150 words unless detailed explanation is needed.`;

const SITE_COPILOT_SYSTEM_INSTRUCTION = `You are ARKY Site Copilot for gk-edge.com.

Your role is to help visitors navigate the website and understand GK Edge services.

Rules:
- Answer in the visitor's own language. If they write in Greek, reply in Greek; the knowledgebase is in English, so translate what you need.
- Use only the provided knowledgebase and conversation context. If the answer is not there, say so plainly rather than guessing.
- Do not invent pricing, certifications, guarantees, client names, case studies, phone numbers or addresses.
- Keep replies concise and practical (2-6 short sentences). Use a short list only when the answer really is a list.
- When suggesting pages, use markdown links with labels (example: [Contact](/contact), [Request a Demo](/request-demo)). For a visitor writing in Greek, prefix the path with /el (example: [Επικοινωνία](/el/contact)).
- The /arky page no longer exists — never link to it or tell users to visit it. If asked to learn more about ARKY or see it in action, point users to [Request a Demo](/request-demo) or [Contact](/contact) instead.
- Do not output raw paths alone unless the user explicitly asks for raw URLs.
- You are the site assistant, not the deployed ARKY product: you answer questions, you do not perform tasks, browse the web or create documents. Say so briefly if asked to.
- If information is missing, say so briefly and suggest contacting info@gk-edge.com.`;

const MODEL = 'gemini-3.1-flash-lite-preview';

/** The preview model answers 503 "high demand" now and then. One quick retry turns most of those into an answer. */
const TRANSIENT_UPSTREAM = /503|UNAVAILABLE|high demand|overloaded|deadline/i;

async function withRetry(run, attempts = 2) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            const described = `${error?.message ?? ''} ${error?.status ?? ''}`;
            if (attempt === attempts || !TRANSIENT_UPSTREAM.test(described)) throw error;
            console.warn(`Upstream hiccup, retrying (${attempt}/${attempts - 1}):`, error?.message || error);
            await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        }
    }
    throw lastError;
}

/** Rejects if the model has not answered in time, so a stalled upstream call does not hold a visitor's browser open. */
function withDeadline(promise, ms, label) {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'timeout' })), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Health check endpoint. It reports what the knowledgebase looks like, so a deploy can be verified without guessing.
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'ARKY Backend API',
        version: '1.1.0',
        endpoints: ['/api/chat', '/api/chat/stream', '/api/contact'],
        model: MODEL,
        knowledgebase: knowledgebasePath ? knowledge.describe() : { sections: 0, characters: 0, mode: 'missing' },
        rateLimits: {
            chat: '10 requests per minute',
            contact: '3 requests per 3 minutes'
        }
    });
});

// Chat endpoint: one request, one complete answer. Kept for clients that cannot read a stream.
app.post('/api/chat', chatLimiter, async (req, res) => {
    if (!ai) {
        return res.status(503).json({ error: 'ARKY is not configured on this server.', code: 'no_api_key' });
    }

    const prepared = prepareChat(req.body);
    if (prepared.error) {
        return res.status(prepared.error.status).json({ error: prepared.error.message, code: prepared.error.code });
    }

    try {
        const response = await withDeadline(
            withRetry(() => ai.models.generateContent({ model: MODEL, contents: prepared.contents, config: prepared.config })),
            LIMITS.replyTimeoutMs,
            'Model call',
        );
        res.json({ reply: response.text || 'I could not put an answer together. Could you rephrase that?' });
    } catch (error) {
        const timedOut = error?.code === 'timeout';
        console.error('Gemini API Error:', error?.message || error);
        res.status(timedOut ? 504 : 502).json({
            error: timedOut ? 'ARKY took too long to answer. Please try again.' : 'ARKY could not reach its AI service.',
            code: timedOut ? 'timeout' : 'upstream_error',
        });
    }
});

/**
 * Chat endpoint that streams the answer as it is written, as server-sent events: `delta` carries the next piece of text,
 * `done` closes a complete answer, `error` reports a failure mid-answer. A visitor sees words within a second instead of
 * watching a spinner for the length of the whole reply.
 */
app.post('/api/chat/stream', chatLimiter, async (req, res) => {
    if (!ai) {
        return res.status(503).json({ error: 'ARKY is not configured on this server.', code: 'no_api_key' });
    }

    const prepared = prepareChat(req.body);
    if (prepared.error) {
        return res.status(prepared.error.status).json({ error: prepared.error.message, code: prepared.error.code });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // proxies must not hold the pieces back
    });
    res.flushHeaders?.();

    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    let closed = false;
    req.on('close', () => { closed = true; });

    try {
        const stream = await withDeadline(
            withRetry(() => ai.models.generateContentStream({ model: MODEL, contents: prepared.contents, config: prepared.config })),
            LIMITS.replyTimeoutMs,
            'Model call',
        );

        let wroteSomething = false;
        for await (const chunk of stream) {
            if (closed) break;
            const text = chunk?.text;
            if (text) {
                wroteSomething = true;
                send('delta', { text });
            }
        }

        if (!closed) send('done', { empty: !wroteSomething });
    } catch (error) {
        const timedOut = error?.code === 'timeout';
        console.error('Gemini stream error:', error?.message || error);
        if (!closed) {
            send('error', {
                error: timedOut ? 'ARKY took too long to answer. Please try again.' : 'ARKY could not reach its AI service.',
                code: timedOut ? 'timeout' : 'upstream_error',
            });
        }
    } finally {
        clearInterval(heartbeat);
        res.end();
    }
});

// Email endpoint with rate limiting
// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

app.post('/api/contact', contactLimiter, async (req, res) => {
    const {
        firstName, lastName, email, message, // From Contact.tsx
        name, company, industry, integrations, automation_goal // From RequestDemo.tsx
    } = req.body;

    const contactName = name || (firstName && lastName ? `${firstName} ${lastName}` : firstName);
    const contactEmail = email;

    if (!contactName || !contactEmail) {
        return res.status(400).json({ error: 'Name and Email are required.' });
    }

    try {
        // Determine which form was submitted based on the payload
        const isDemoRequest = !!industry;
        
        const subject = isDemoRequest
            ? `New Demo Request: ${contactName} from ${company || 'Unknown Company'}`
            : `New Lead: ${contactName}`;

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
                <br/>
                <p><strong>Message:</strong></p>
                <p>${message || 'No additional message provided.'}</p>
            `;

        const { data, error } = await resend.emails.send({
            from: 'GK Edge <notifications@gk-edge.com>', 
            to: ['info@gk-edge.com'],
            subject: subject,
            html: htmlContent,
            reply_to: contactEmail
        });

        if (error) {
            console.error("Resend API Error:", error);
            return res.status(500).json({ error: 'Failed to send email via Resend.' });
        }

        console.log("Email sent successfully via Resend:", data.id);
        res.json({ success: true, message: 'Message sent successfully!' });

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
