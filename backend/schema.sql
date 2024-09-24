-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS "BillOccurrence";
DROP TABLE IF EXISTS "Bill";
DROP TABLE IF EXISTS "Todo";
DROP TABLE IF EXISTS "Paycheck";

-- Create "Bill" table (stores bill series)
CREATE TABLE IF NOT EXISTS "Bill" (
    "id" TEXT PRIMARY KEY NOT NULL, -- Unique identifier for the bill series
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL CHECK ("amount" >= 0),
    "dueDate" TEXT NOT NULL, -- Initial due date for the first occurrence (YYYY-MM-DD)
    "recurrence" TEXT NOT NULL CHECK ("recurrence" IN ('none', 'weekly', 'monthly', 'yearly')),
    "skipped" INTEGER NOT NULL DEFAULT 0 CHECK ("skipped" IN (0, 1)),
    "deletedFromDate" TEXT -- Marks when future occurrences stop
);

-- Create "BillOccurrence" table (stores individual occurrences)
CREATE TABLE IF NOT EXISTS "BillOccurrence" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "bill_id" TEXT NOT NULL,
    "name" TEXT, -- Customizable name for each occurrence, defaults to Bill.name
    "due_date" TEXT NOT NULL, -- Specific due date for the occurrence (YYYY-MM-DD)
    "is_paid" INTEGER NOT NULL DEFAULT 0 CHECK ("is_paid" IN (0, 1)),
    "paid_date" TEXT, -- Optional date when the bill was paid
    "amount" REAL, -- Can vary from the base bill amount
    "status" TEXT NOT NULL CHECK ("status" IN ('upcoming', 'completed', 'missed', 'skipped')),
    "deleted" INTEGER NOT NULL DEFAULT 0 CHECK ("deleted" IN (0, 1)),
    FOREIGN KEY("bill_id") REFERENCES "Bill"("id") ON DELETE CASCADE,
    UNIQUE ("bill_id", "due_date") -- **Unique Constraint Added**
);

-- Create "Todo" table
CREATE TABLE IF NOT EXISTS "Todo" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "task" TEXT NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 0 CHECK ("completed" IN (0, 1)),
    "dueDate" TEXT NOT NULL -- (YYYY-MM-DD)
);

-- Create "Paycheck" table
CREATE TABLE IF NOT EXISTS "Paycheck" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "amount" REAL NOT NULL CHECK ("amount" >= 0),
    "date" TEXT NOT NULL -- (YYYY-MM-DD)
);
