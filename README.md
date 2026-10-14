# 3xCode Management System

A premium, futuristic business management web application for modern software development and digital services companies.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion, TanStack Query
- **Backend**: Node.js, Express.js, TypeScript, Prisma ORM, MySQL
- **Deployment**: Ubuntu 24.04 LTS, Nginx, PM2, Let's Encrypt

## Quick Start

### Prerequisites

- Node.js 18+ (v24 recommended)
- MySQL 8.0+
- Git

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   cd frontend && npm install
   cd backend && npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   cp backend/.env.example backend/.env
   ```

4. Configure database in `backend/.env`
5. Run database migrations:
   ```bash
   cd backend && npx prisma migrate dev
   npx prisma db seed
   ```

6. Start development servers:
   ```bash
   npm run dev
   ```

### Build for Production

```bash
npm run build
```

## Project Structure

See the full specification in the prompt for complete requirements including CRM, Project Management, Finance, Invoicing, Client Portal, and more.
