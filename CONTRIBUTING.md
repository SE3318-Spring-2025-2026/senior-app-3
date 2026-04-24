# Contributing to Senior Project Management System

Thank you for contributing! This document covers the workflow, conventions, and setup steps you need to get started.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Code Style](#code-style)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Docker)
- Git

### Local Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/SE3318-Spring-2025-2026/senior-app-3.git
cd senior-app-3

# 2. Set up the backend
cd backend
npm install
cp .env.example .env   # fill in your local values
npm run dev            # runs on http://localhost:5002

# 3. Set up the frontend (new terminal)
cd frontend
npm install
cp .env.example .env.local   # fill in your local values
npm start              # runs on http://localhost:3000

# 4. (Optional) Seed the database
cd backend
npm run seed
```

---

## Branch Naming

Branches must follow this pattern so they link automatically to GitHub issues:

```
{issue-number}-{short-description-in-kebab-case}
```

**Examples:**
- `123-FE-login-page-redesign`
- `124-BE-jwt-refresh-endpoint`
- `125-fix-advisor-dashboard-crash`

Prefix with `FE-`, `BE-`, or `fix-` where it adds clarity. Keep descriptions short (3–5 words).

---

## Commit Messages

Use the imperative mood and keep the subject line under 72 characters.

```
Add committee results view for advisors
Fix null pointer in grade submission handler
Update seed script to include test committee data
```

Avoid messages like "fix stuff", "WIP", or "changes". Each commit should represent one logical unit of work.

---

## Pull Requests

1. **Open an issue first** for non-trivial changes so the work can be discussed before implementation.
2. **Branch off `main`** and keep your branch up to date:
   ```bash
   git fetch origin
   git rebase origin/main
   ```
3. **Fill out the PR description** — include what changed, why, and how to test it.
4. **Request at least one review** before merging.
5. **Do not merge your own PR** unless explicitly approved to do so.
6. Resolve all review comments before merging.

---

## Code Style

### Backend (Node.js)

- Use `async/await` over raw `.then()` chains.
- Keep route handlers thin — move business logic into service/helper files under `src/`.
- Validate all input at the route boundary; do not trust request bodies downstream.
- Do not commit `.env` files or secrets.

### Frontend (React)

- Components go in `src/components/` or the relevant feature folder.
- Use Tailwind utility classes; avoid writing raw CSS unless there is no Tailwind equivalent.
- Keep components focused — if a component exceeds ~150 lines, consider splitting it.
- Prefer `const` arrow functions for components over `function` declarations.

---

## Running Tests

### Backend

```bash
cd backend
npm test              # run all tests once
npm run test:watch    # watch mode during development
```

### Frontend

```bash
cd frontend
npm test              # interactive watch mode
```

Tests must pass before a PR can be merged. Do not disable or skip tests to get CI green — fix them.

---

## Project Structure

```
senior-app-3/
├── backend/
│   ├── src/          # routes, controllers, services, models
│   ├── migrations/   # database migrations
│   ├── tests/        # backend test suites
│   └── seed.js       # database seeding script
└── frontend/
    ├── src/
    │   ├── components/
    │   └── ...
    └── public/
```

Refer to [ARCHITECTURE_PRESENTATION.md](ARCHITECTURE_PRESENTATION.md) for a deeper look at the system design.

---

## Questions?

Open a GitHub issue or reach out to the team via your course communication channel.
