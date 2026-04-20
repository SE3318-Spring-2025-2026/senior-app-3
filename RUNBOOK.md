# 🛠️ System Bootup (Localhost Setup)

This runbook matches the **Senior App** layout: a **Node.js + Express** API under `backend/` and a **Create React App** (`react-scripts`) client under `frontend/`. The frontend proxies API calls to the backend via `frontend/package.json` → `"proxy": "http://localhost:5002"`, so the backend should listen on **port 5002** during local demos unless you change both sides.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | **20.x LTS** recommended. Backend devDependencies (e.g. `mongodb-memory-server@11`) declare `>=20.19.0`; using **20.19+** avoids `EBADENGINE` warnings during `npm install`. |
| **npm** | Bundled with Node (npm 9/10 is fine). |
| **MongoDB Server** | Local **MongoDB Community** (mongod on `localhost:27017`) or Docker equivalent. The app defaults to `mongodb://localhost:27017/senior-app`. |
| **MongoDB Compass** (optional but recommended for demos) | GUI to inspect `groups`, `committees`, `deliverables`, `sprint_records`, `advisorrequests`, `schedulewindows`. |
| **Two terminals** | One for backend, one for frontend. |
| **Git** | For cloning; not required at runtime. |

> **Not used in this repo:** The frontend is **not** Vite-based; it uses **Create React App** (`react-scripts start`).

---

## Environment Variables

Create **`backend/.env`** (you may copy from `backend/.env.example` and adjust). Below is a **minimal local demo template** aligned with `backend/src/index.js` (default `PORT` **5002**, URI variable **`MONGODB_URI`**):

```env
# Server
PORT=5002
NODE_ENV=development

# Database (required for Mongoose)
MONGODB_URI=mongodb://localhost:27017/senior-app

# JWT (required for auth tokens used by the UI)
JWT_SECRET=local-dev-jwt-secret-change-me
JWT_REFRESH_SECRET=local-dev-jwt-refresh-secret-change-me
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d

# Frontend (password reset links, CORS-related flows)
FRONTEND_URL=http://localhost:3000

# Optional: GitHub OAuth — only if you demo OAuth; placeholders are fine for Process 3.0 / 4.0 UI paths
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=http://localhost:5002/api/v1/auth/github/oauth/callback

# Email — dev mode often logs only; placeholders are acceptable for local demos
EMAIL_USER=your-email@gmail.com
EMAIL_SERVICE=gmail
EMAIL_PASSWORD=your-app-password
```

**Important:** If you change `PORT` away from **5002**, update `frontend/package.json` `proxy` to the same origin, or configure the frontend API base URL accordingly.

---

## Database: migrations & seed data

From the **`backend/`** directory, with MongoDB running:

```bash
cd backend
npm install
npm run migrate:up
npm run seed
```

- **`migrate:up`** — applies versioned migrations (see `backend/migrations/index.js`, invoked by `backend/src/migrate.js`).
- **`seed`** — runs `backend/seed.js`: loads registry students, creates **test users** (professors, coordinator, students), and **sample groups** (e.g. Alpha Team, Beta Squad, Gamma Force). Console output lists emails and temporary passwords for professors/students where applicable.

**Seed accounts (typical):**

| Role | Email | Password (from seed) |
|------|--------|----------------------|
| Coordinator | `coordinator@university.edu` | `CoordPass1!` |
| Professor | `prof.smith@university.edu` | `TempPass1!` |
| Student | `diana@university.edu` | `TempPass1!` |

Use the actual `groupId` values from **Compass** (`groups` collection) when navigating to `/groups/:group_id/...` routes.

---

## Backend boot

```bash
cd backend
npm install
npm run dev
```

**Expected console output (normal startup):**

- `Server is running on port 5002` (or your `PORT`)
- `Environment: development`
- `MongoDB connected successfully`

**Health check:** open [http://localhost:5002/health](http://localhost:5002/health) — expect JSON `{ "status": "ok", ... }`.

**Scripts (from `backend/package.json`):** `npm run dev` → `nodemon src/index.js`; `npm start` → `node src/index.js`.

**Troubleshooting:** If `node` exits with `Cannot find module './routes/jury'`, ensure `backend/src/routes/jury.js` exists and matches `require('./routes/jury')` in `backend/src/index.js`, or adjust the import to match your branch.

---

## Frontend boot

```bash
cd frontend
npm install
npm start
```

- **URL:** [http://localhost:3000](http://localhost:3000) (CRA default).
- The dev server proxies `/api` to `http://localhost:5002` per `proxy` in `frontend/package.json`.

---

# 🧪 Running the Test Suites (The Quality Proof)

All commands below assume you are in the **project root** or the named folder.

## Backend — Jest + `supertest` + `MongoMemoryReplSet`

Integration tests live under **`backend/tests/`**. Files such as **`committee-integration.test.js`** and **`committee-notification.test.js`** spin up **`MongoMemoryReplSet`** so **`session.withTransaction()`** (committee publish) can run like on a replica set.

From **`backend/`**:

```bash
cd backend
npm test -- committee-integration.test.js --runInBand
```

- **`--runInBand`** runs tests serially — recommended for integration suites that start/stop MongoDB in memory.
- Additional ReplSet-backed suite example:

```bash
npm test -- committee-notification.test.js --runInBand
```

The file `backend/tests/committee-integration.test.js` documents the same `npm test -- committee-integration.test.js` invocation in its header comment.

**General backend test run:**

```bash
cd backend
npm test
```

---

## Frontend — React Testing Library

From **`frontend/`**:

```bash
cd frontend
npm test
```

CRA’s test runner defaults to **watch mode**. For a **single non-interactive run** (CI-style):

```bash
cd frontend
set CI=true
npm test
```

(On Windows PowerShell you can use `$env:CI='true'; npm test`.)

Representative UI tests for Process 4.0 / deliverables include files under `frontend/src/__tests__/`, e.g. `CommitteeManagementTab.test.js`, `CommitteeE2EFlow.test.js`, `DeliverableSubmissionForm.test.js`.

---

# 🎬 Live Demo Script (Step-by-Step Presentation)

**Before Act 1 — open operational schedule windows**

Many advisor and deliverable routes use **`checkAdvisorOperationWindow`** / **`checkScheduleWindow`** middleware. The **Coordinator Panel** UI dropdown for new schedule windows only lists *Group Creation* and *Member Addition* (`CoordinatorPanel.js`), but the API accepts **all** values in `VALID_OPERATION_TYPES` (`backend/src/utils/operationTypes.js`).

**Recommended before the live demo:** as a **coordinator**, create **active** windows (future `endsAt`, past `startsAt`) for at least:

- `advisor_association`
- `advisor_decision`
- `deliverable_submission`

Use **`POST /api/v1/schedule-window`** with a coordinator JWT (e.g. Postman), or insert equivalent documents into the **`schedulewindows`** collection via **Compass** (fields: `windowId`, `operationType`, `startsAt`, `endsAt`, `isActive`, `createdBy`, `label`).

**Optional — link groups on publish:** `POST /api/v1/committees/:committeeId/publish` accepts **`assignedGroupIds`** in the JSON body (`backend/src/controllers/committees.js`). Passing your demo **`groupId`** values ensures **D2** `committeeId` / `committeePublishedAt` are set so students see **published** committee status on the group dashboard. The bundled **`CommitteeManagementTab`** publish helper calls publish **without** that body; for a full D2 link demo, use the API or extend the client for the day of the demo.

---

## Act 1 — Advisor Association (Process 3.0)

**Goal:** Show request → professor approval → **D2** group fields updated.

1. **Student login**  
   - Open [http://localhost:3000/auth/login](http://localhost:3000/auth/login).  
   - Sign in with a seeded **student** (e.g. `diana@university.edu` / `TempPass1!`).

2. **Advisee Request Form**  
   - Navigate to **`/groups/<group_id>/advisor-request`** (replace `<group_id>` with a real `groupId` from Compass for that user’s group, e.g. **Alpha Team** leader).  
   - Complete and **submit** the advisee request form (`AdviseeRequestForm.js`).

3. **Professor inbox**  
   - Log out; log in as **`prof.smith@university.edu`** (or the professor referenced in the request).  
   - Open [http://localhost:3000/professor/inbox](http://localhost:3000/professor/inbox) (`ProfessorInbox.js`).  
   - Locate the pending request and click **Approve** (button label **Approve**).

4. **Prove D2 in Compass**  
   - Open the **`groups`** collection.  
   - Find the document by `groupId`.  
   - Show **`advisorId`** populated and **`advisorStatus`** / **`advisorAssignedAt`** (and related advisor fields) updated per `backend/src/models/Group.js`.

---

## Act 2 — Committee Assignment (Process 4.0)

**Goal:** Draft committee → assign advisors & jury → validate → publish → narrate **transactional D3 + D2**.

1. **Coordinator login**  
   - Log in as **`coordinator@university.edu`** / `CoordPass1!`.

2. **Coordinator panel — Committees**  
   - Go to [http://localhost:3000/coordinator](http://localhost:3000/coordinator).  
   - Click the **Committees (N)** tab.  
   - Click **+ New Committee** → you are routed to **`/coordinator/committees/new`** (`CommitteeCreationForm.js`).  
   - Submit a **draft** (name + optional description). You return to **`/coordinator`** — the new committee appears in the table with status **`draft`**.

3. **Assign jury (routed UI)**  
   - In the committees table, click **Assign Jury** for the row (`JuryAssignmentForm.js` at `/coordinator/committees/:committeeId/jury`).  
   - Select professors and save (Process **4.3**).

4. **Assign advisors**  
   - The main **`CoordinatorPanel`** table does not expose a dedicated “Assign Advisors” button row action. Use one of:  
     - **`POST /api/v1/committees/:committeeId/advisors`** with coordinator auth, or  
     - The standalone component **`frontend/src/components/CommitteeManagementTab.js`**, which includes advisor/jury selection and **Validate / Publish** — *this component is not mounted in `frontend/src/App.js` by default; for a click-through demo, add a temporary **ProtectedRoute** (e.g. `/coordinator/committees/manage`) pointing at `CommitteeManagementTab` during rehearsal only.*

5. **Validate**  
   - In **`CommitteeManagementTab`** (if mounted): select the committee, click **Validate** — if invalid, show how the UI/API surfaces **missing requirements** / locked state.  
   - Alternatively call **`POST /api/v1/committees/:committeeId/validate`**.

6. **Publish**  
   - Click **Publish** (with confirm dialog in `CommitteeManagementTab`) or **`POST /api/v1/committees/:committeeId/publish`**.  
   - **Narrative for stakeholders:** **`backend/src/services/committeePublishService.js`** runs **`session.withTransaction`**: updates **D3** (`Committee` → `published`), **D2** groups when `assignedGroupIds` is provided, and audit logs; **notifications** are dispatched **after** the transaction via **`notificationService`** (non-blocking relative to the DB commit).

---

## Act 3 — Student Deliverable Submission

**Goal:** Published committee visible to student → submit artifact → show **D4** + **D6**.

1. **Ensure D2 link**  
   - The student’s group must have **`committeeId`** pointing at a **published** committee (see **assignedGroupIds** on publish, or manual update for rehearsal only).

2. **Open schedule window**  
   - Ensure an active **`deliverable_submission`** window exists (see prerequisites above).

3. **Student — group dashboard**  
   - Log in as **team leader** student (`DeliverableSubmissionForm` allows submit only for **leader** when committee status is published).  
   - Navigate to **`/groups/<group_id>`** (`GroupDashboard.js`).  
   - Point out **`CommitteeStatusCard`**: committee appears **published**.

4. **Submit**  
   - In **Deliverable Submission**, choose type (Proposal / etc.), **file or link**, and submit.  
   - On success, the UI shows confirmation and listed submissions.

5. **Prove D4 & D6 in Compass**  
   - **`deliverables`** collection (**D4**): new document with `storageRef`, `submittedAt`, `committeeId`, `groupId`.  
   - **`sprint_records`** collection (**D6**): corresponding `SprintRecord` updated with **`deliverableRefs`** / committee linkage per `backend/src/services/deliverableService.js` and `backend/src/models/SprintRecord.js`.

---

## Quick reference — key routes

| App | Path |
|-----|------|
| Login | `/auth/login` |
| Advisee request | `/groups/:group_id/advisor-request` |
| Professor inbox | `/professor/inbox` |
| Coordinator | `/coordinator` (tabs: Groups, Overrides, Transfer, Schedule, Health, **Committees**) |
| New committee | `/coordinator/committees/new` |
| Jury assignment | `/coordinator/committees/:committeeId/jury` |
| Group dashboard | `/groups/:group_id` |

---

*This runbook reflects `backend/package.json`, `frontend/package.json`, `backend/.env.example`, `backend/src/index.js`, and `frontend/src/App.js` as of the repository revision used to generate it.*
