# ARKY Backend API

This folder contains the Express.js backend API for the ARKY application.

## Hostinger Deployment Configuration

**Framework preset:** Express
**Root directory:** `/backend`
**Entry file:** `server.js`
**Package manager:** npm
**Node version:** 20.x or 22.x

## Environment Variables (Set in Hostinger)

- `GEMINI_API_KEY` - Your Google Gemini API key

## What This Backend Does

- Provides `/api/chat` endpoint for AI chat functionality
- Provides `/api/contact` endpoint for email (not currently used by frontend)
- Serves with CORS enabled for the frontend domains
