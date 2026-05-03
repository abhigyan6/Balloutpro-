# 🏏 Balloutpro

**Balloutpro** is an AI-powered cricket decision assistant that automates umpiring decisions for LBW, Run-outs, and Edge Detection. Built with Google Gemini AI and Firebase, it delivers real-time, accurate decisions to enhance the game experience.

> 🔗 **Live App:** [View on AI Studio](https://ais-dev-tunpgfnv7ofbip3e2vgcd2-638838999573.asia-east1.run.app/)

---

## ✨ Features

- 🤖 **AI-Powered Decisions** — Uses Google Gemini AI to analyze and deliver cricket umpiring verdicts
- 🎯 **Decision Types Supported** — LBW, Run-out, and Edge Detection
- 📊 **Match Stats Tracking** — Stores and updates match data in real time via Firestore
- 🔐 **Secure by Default** — Firestore rules enforce authenticated writes and strict data validation
- 🎉 **Smooth UI** — Built with React 19, Tailwind CSS, Framer Motion, and Lucide icons

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Build Tool | Vite 6 |
| AI | Google Gemini (`@google/genai`) |
| Backend/DB | Firebase Firestore |
| Animation | Framer Motion (`motion`) |
| Icons | Lucide React |
| Confetti | canvas-confetti |

---

## 📁 Project Structure

```
Balloutpro-/
├── src/                        # Main source code
├── index.html                  # Entry HTML
├── firestore.rules             # Production Firestore security rules
├── DRAFT_firestore.rules       # Draft/WIP security rules
├── firebase-blueprint.json     # Firebase project blueprint
├── firebase-applet-config.json # Firebase applet configuration
├── security_spec.md            # Security specification document
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript configuration
├── .env.example                # Environment variable template
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Google Gemini API Key](https://aistudio.google.com/apikey)
- A Firebase project (for Firestore)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/abhigyan6/Balloutpro-.git
   cd Balloutpro-
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Copy the example env file and fill in your keys:
   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3000`

---

## 📜 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server on port 3000 |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Type-check with TypeScript |
| `npm run clean` | Remove the `dist` folder |

---

## 🔐 Firestore Security Rules

Balloutpro uses strict Firestore security rules:

- **Default deny** — all reads/writes are blocked unless explicitly allowed
- **`/decisions`** — publicly readable; only authenticated users can create valid decisions (no updates or deletes)
- **`/matches`** — publicly readable; only authenticated users can create or update valid match records (no deletes)

Decision documents must include: `match_id`, `batsman`, `bowler`, `decision_type` (one of `LBW`, `Run-out`, `Edge Detection`), `result` (one of `OUT`, `NOT OUT`, `UMPIRE'S CALL`), and a server `timestamp`.

---

## 🌐 Deployment

The app is deployable on any static hosting platform. For Vercel:

```bash
npm run build
# Deploy the generated `dist/` folder
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 👤 Author

**Abhigyan** — [@abhigyan6](https://github.com/abhigyan6)
Virendra 
aman
