"use client";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { Context } from "hono";
import { D1Database } from "@cloudflare/workers-types";
import { v4 as uuidv4 } from "uuid";
import {
  parseISO,
  isBefore,
  isAfter,
  formatISO,
  addWeeks,
  addMonths,
  addYears,
  addDays,
} from "date-fns";

interface Env {
  D1_DATABASE: D1Database;
}

interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  recurrence: "none" | "weekly" | "monthly" | "yearly";
  skipped: boolean;
  deletedFromDate: string | null;
}

interface BillOccurrence {
  id: string;
  bill_id: string;
  name: string;
  due_date: string;
  is_paid: boolean;
  paid_date: string | null;
  amount: number;
  status: "upcoming" | "completed" | "missed" | "skipped";
  deleted: boolean;
}

interface Paycheck {
  id: string;
  amount: number;
  date: string;
}

interface Todo {
  id: string;
  task: string;
  completed: boolean;
  dueDate: string;
}

const app = new Hono<Env>();

// Enable CORS for all routes
app.use("*", cors());

// Utility function to handle database queries with error handling
async function queryDB(
  ctx: Context<Env>,
  sql: string,
  params: any[] = []
): Promise<any> {
  try {
    const result = await ctx.env.D1_DATABASE.prepare(sql)
      .bind(...params)
      .all();
    return result;
  } catch (error) {
    console.error("Database query error:", error);
    throw new Error(
      `Database query failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Function to generate occurrences for a recurring bill up to a specified date
async function generateOccurrences(
  bill: Bill,
  monthsAhead: number = 12,
  ctx: Context<Env>
): Promise<BillOccurrence[]> {
  const occurrences: BillOccurrence[] = [];
  let currentDate: Date;

  // Validate and parse the bill's dueDate
  try {
    currentDate = parseISO(bill.dueDate);
    if (isNaN(currentDate.getTime())) {
      throw new Error("Invalid dueDate format");
    }
  } catch (error) {
    console.error(`Invalid dueDate for bill ${bill.id}: ${bill.dueDate}`);
    // Optionally, you can choose to skip generating occurrences for this bill
    return occurrences;
  }

  const endDate = addMonths(currentDate, monthsAhead);

  while (!isAfter(currentDate, endDate)) {
    // Validate and parse deletedFromDate if it exists
    if (bill.deletedFromDate) {
      let deletedFrom: Date;
      try {
        deletedFrom = parseISO(bill.deletedFromDate);
        if (isNaN(deletedFrom.getTime())) {
          throw new Error("Invalid deletedFromDate format");
        }
      } catch (error) {
        console.error(
          `Invalid deletedFromDate for bill ${bill.id}: ${bill.deletedFromDate}`
        );
        // Decide whether to skip or handle differently
        break;
      }

      if (!isBefore(currentDate, deletedFrom)) {
        break;
      }
    }

    const occurrenceDate = formatISO(currentDate, { representation: "date" });

    // Check if the occurrence already exists
    let existing;
    try {
      existing = await queryDB(
        ctx,
        `SELECT * FROM BillOccurrence WHERE bill_id = ? AND due_date = ? AND deleted = 0`,
        [bill.id, occurrenceDate]
      );
    } catch (error) {
      console.error(
        `Error checking existing occurrences for bill_id ${bill.id} on ${occurrenceDate}:`,
        error
      );
      // Decide whether to continue or abort
      break;
    }

    if (existing.results.length === 0) {
      const occurrence: BillOccurrence = {
        id: uuidv4(),
        bill_id: bill.id,
        name: bill.name, // Can be customized
        due_date: occurrenceDate,
        is_paid: false,
        paid_date: null,
        amount: bill.amount, // Can be customized per occurrence
        status: "upcoming",
        deleted: false,
      };
      occurrences.push(occurrence);
    }

    // Increment date based on recurrence rule
    if (bill.recurrence === "weekly") {
      currentDate = addWeeks(currentDate, 1);
    } else if (bill.recurrence === "monthly") {
      currentDate = addMonths(currentDate, 1);
    } else if (bill.recurrence === "yearly") {
      currentDate = addYears(currentDate, 1);
    } else {
      break; // Stop after one occurrence if it's non-recurring
    }
  }

  return occurrences;
}

/**
 * Bills Routes
 */

// POST /api/bills - Create a new bill with error handling
app.post("/api/bills", async (c) => {
  try {
    const { name, amount, dueDate, recurrence } = await c.req.json<{
      name: string;
      amount: number;
      dueDate: string;
      recurrence: "none" | "weekly" | "monthly" | "yearly";
    }>();

    // Validate required fields
    if (!name || amount === undefined || !dueDate || !recurrence) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Validate recurrence
    const validRecurrences = ["none", "weekly", "monthly", "yearly"];
    if (!validRecurrences.includes(recurrence)) {
      return c.json({ error: "Invalid recurrence value" }, 400);
    }

    // Validate dueDate format
    const parsedDueDate = parseISO(dueDate);
    if (isNaN(parsedDueDate.getTime())) {
      return c.json({ error: "Invalid dueDate format. Use YYYY-MM-DD." }, 400);
    }

    const billId = uuidv4(); // Unique identifier for the bill series

    const newBill: Bill = {
      id: billId,
      name,
      amount,
      dueDate,
      recurrence,
      skipped: false,
      deletedFromDate: null,
    };

    // Insert the new bill into the Bill table
    const insertBillSQL = `
      INSERT INTO Bill (id, name, amount, dueDate, recurrence, skipped, deletedFromDate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const billParams = [
      newBill.id,
      newBill.name,
      newBill.amount,
      newBill.dueDate,
      newBill.recurrence,
      newBill.skipped ? 1 : 0,
      newBill.deletedFromDate,
    ];

    await c.env.D1_DATABASE.prepare(insertBillSQL)
      .bind(...billParams)
      .run();

    // Generate initial occurrences (e.g., next 12 months)
    const initialOccurrences = await generateOccurrences(newBill, 12, c);

    const insertOccurrenceSQL = `
      INSERT INTO BillOccurrence (id, bill_id, name, due_date, is_paid, paid_date, amount, status, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const occurrenceStmt = c.env.D1_DATABASE.prepare(insertOccurrenceSQL);

    for (const occ of initialOccurrences) {
      try {
        await occurrenceStmt
          .bind(
            occ.id,
            occ.bill_id,
            occ.name,
            occ.due_date,
            occ.is_paid ? 1 : 0,
            occ.paid_date,
            occ.amount,
            occ.status,
            occ.deleted ? 1 : 0
          )
          .run();
      } catch (err: any) {
        if (err.message.includes("unique_bill_due_date")) {
          console.warn(
            `Duplicate occurrence for bill_id ${occ.bill_id} on ${occ.due_date} skipped.`
          );
        } else {
          console.error("Error inserting occurrence:", err);
          throw new Error("Failed to insert bill occurrence.");
        }
      }
    }

    return c.json({ message: "Bill created successfully", bill: newBill }, 201);
  } catch (error: any) {
    console.error("Error creating bill:", error);
    if (error.message.includes("unique_bill_due_date")) {
      return c.json({ error: "Duplicate bill occurrence detected." }, 409);
    }
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to create bill",
      },
      500
    );
  }
});

// GET /api/bills - Retrieve bill occurrences within a date range with error handling
app.get("/api/bills", async (c) => {
  try {
    const month = c.req.query("month"); // Expected format: 'YYYY-MM'

    if (!month) {
      return c.json(
        { error: "Month parameter is required (format: YYYY-MM)" },
        400
      );
    }

    // Parse the month parameter
    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const monthNumber = parseInt(monthStr);

    if (
      isNaN(year) ||
      isNaN(monthNumber) ||
      monthNumber < 1 ||
      monthNumber > 12
    ) {
      return c.json({ error: "Invalid month format. Use YYYY-MM." }, 400);
    }

    const startDate = formatISO(new Date(year, monthNumber - 1, 1), {
      representation: "date",
    });
    const endDate = formatISO(new Date(year, monthNumber, 0), {
      representation: "date",
    }); // Last day of the month

    console.log(`Fetching bills from ${startDate} to ${endDate}`);

    // Retrieve existing occurrences within the date range
    const existingOccurrencesResult = await queryDB(
      c,
      `SELECT * FROM BillOccurrence
       WHERE due_date BETWEEN ? AND ?
       AND deleted = 0`,
      [startDate, endDate]
    );
    const existingOccurrences =
      existingOccurrencesResult.results as BillOccurrence[];

    // Identify which bills need occurrences to be generated
    const billsResult = await queryDB(
      c,
      `SELECT * FROM Bill
       WHERE deletedFromDate IS NULL OR deletedFromDate > ?`,
      [endDate]
    );
    const bills = billsResult.results as Bill[];

    const occurrencesToInsert: BillOccurrence[] = [];

    for (const bill of bills) {
      // Determine if an occurrence for this bill and month already exists
      const hasOccurrence = existingOccurrences.some(
        (occ) => occ.bill_id === bill.id && occ.due_date.startsWith(month) // 'YYYY-MM'
      );

      if (!hasOccurrence) {
        // Calculate the number of months between bill.dueDate and target month
        const billDueDate = parseISO(bill.dueDate);
        const targetDate = new Date(year, monthNumber - 1, 1);
        const monthsDifference =
          (year - billDueDate.getFullYear()) * 12 +
          (monthNumber - 1 - billDueDate.getMonth());

        if (monthsDifference < 0) {
          continue; // Skip bills that start after the target month
        }

        // Generate occurrences up to the target month
        const generatedOccurrences = await generateOccurrences(
          bill,
          monthsDifference + 1,
          c
        );
        for (const occ of generatedOccurrences) {
          // Only insert occurrences within the target month
          if (occ.due_date.startsWith(month)) {
            occurrencesToInsert.push(occ);
          }
        }
      }
    }

    console.log(
      `Generating ${occurrencesToInsert.length} new occurrences for month ${month}`
    );

    // Insert new occurrences into the BillOccurrence table
    if (occurrencesToInsert.length > 0) {
      const insertOccurrenceSQL = `
        INSERT INTO BillOccurrence (id, bill_id, name, due_date, is_paid, paid_date, amount, status, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const occurrenceStmt = c.env.D1_DATABASE.prepare(insertOccurrenceSQL);

      for (const occ of occurrencesToInsert) {
        try {
          await occurrenceStmt
            .bind(
              occ.id,
              occ.bill_id,
              occ.name,
              occ.due_date,
              occ.is_paid ? 1 : 0,
              occ.paid_date,
              occ.amount,
              occ.status,
              occ.deleted ? 1 : 0
            )
            .run();
        } catch (err: any) {
          if (err.message.includes("unique_bill_due_date")) {
            console.warn(
              `Duplicate occurrence for bill_id ${occ.bill_id} on ${occ.due_date} skipped.`
            );
          } else {
            console.error("Error inserting occurrence:", err);
            // Decide whether to continue or abort
            throw new Error("Failed to insert bill occurrences.");
          }
        }
      }
    }

    // Retrieve all occurrences within the date range after insertion
    const finalOccurrencesResult = await queryDB(
      c,
      `SELECT * FROM BillOccurrence
       WHERE due_date BETWEEN ? AND ?
       AND deleted = 0`,
      [startDate, endDate]
    );
    const finalOccurrences = finalOccurrencesResult.results as BillOccurrence[];

    console.log(
      `Returning ${finalOccurrences.length} occurrences for month ${month}`
    );

    return c.json(finalOccurrences);
  } catch (error: any) {
    console.error("Error fetching bills:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch bills",
      },
      500
    );
  }
});

// PUT /api/bills/:id - Update a bill occurrence or future occurrences with error handling
app.put("/api/bills/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const { name, amount, dueDate, is_paid, paid_date, status, updateOption } =
      await c.req.json<{
        name?: string;
        amount?: number;
        dueDate?: string;
        is_paid?: boolean;
        paid_date?: string | null;
        status?: "upcoming" | "completed" | "missed" | "skipped";
        updateOption: "this" | "future";
      }>();

    // Validate updateOption
    if (
      !updateOption ||
      (updateOption !== "this" && updateOption !== "future")
    ) {
      return c.json(
        { error: "Invalid updateOption. Choose 'this' or 'future'." },
        400
      );
    }

    // Fetch existing occurrence
    const existingOccurrenceResult = await queryDB(
      c,
      "SELECT * FROM BillOccurrence WHERE id = ?",
      [id]
    );
    if (existingOccurrenceResult.results.length === 0) {
      return c.json({ error: "Bill occurrence not found" }, 404);
    }
    const existingOccurrence: BillOccurrence = existingOccurrenceResult
      .results[0] as BillOccurrence;

    const updatedFields: Partial<BillOccurrence> = {
      name: name !== undefined ? name : existingOccurrence.name,
      amount: amount !== undefined ? amount : existingOccurrence.amount,
      // Conditional handling for due_date
      due_date: dueDate !== undefined ? dueDate : existingOccurrence.due_date,
      is_paid: is_paid !== undefined ? is_paid : existingOccurrence.is_paid,
      paid_date:
        paid_date !== undefined ? paid_date : existingOccurrence.paid_date,
      status: status !== undefined ? status : existingOccurrence.status,
    };

    if (updateOption === "this") {
      // Update only this occurrence
      const sqlUpdate = `
        UPDATE BillOccurrence
        SET name = ?, amount = ?, due_date = ?, is_paid = ?, paid_date = ?, status = ?
        WHERE id = ?
      `;
      const paramsUpdate = [
        updatedFields.name,
        updatedFields.amount,
        updatedFields.due_date,
        updatedFields.is_paid ? 1 : 0,
        updatedFields.paid_date,
        updatedFields.status,
        id,
      ];
      await c.env.D1_DATABASE.prepare(sqlUpdate)
        .bind(...paramsUpdate)
        .run();
    } else if (updateOption === "future") {
      // Prevent updating due_date when updating future occurrences
      if (dueDate !== undefined && dueDate !== existingOccurrence.due_date) {
        return c.json(
          {
            error:
              "Updating 'due_date' for future occurrences is not allowed to prevent duplicates.",
          },
          400
        );
      }

      // Update this and future occurrences
      const sqlUpdateFuture = `
        UPDATE BillOccurrence
        SET name = ?, amount = ?, is_paid = ?, paid_date = ?, status = ?
        WHERE bill_id = ? AND due_date >= ?
      `;
      await c.env.D1_DATABASE.prepare(sqlUpdateFuture)
        .bind(
          updatedFields.name,
          updatedFields.amount,
          updatedFields.is_paid ? 1 : 0,
          updatedFields.paid_date,
          updatedFields.status,
          existingOccurrence.bill_id,
          existingOccurrence.due_date
        )
        .run();

      // Set deletedFromDate to the day after due_date
      const newDeletedFromDate = formatISO(
        addDays(parseISO(existingOccurrence.due_date), 1),
        { representation: "date" }
      );

      const sqlUpdateBill = `
        UPDATE Bill
        SET deletedFromDate = ?
        WHERE id = ?
      `;
      await c.env.D1_DATABASE.prepare(sqlUpdateBill)
        .bind(newDeletedFromDate, existingOccurrence.bill_id)
        .run();
    }

    return c.json({
      message: "Bill occurrence(s) updated successfully",
      billOccurrence: { ...existingOccurrence, ...updatedFields },
    });
  } catch (error: any) {
    console.error("Error updating bill occurrence:", error);
    if (error.message.includes("unique_bill_due_date")) {
      return c.json(
        { error: "Updating this bill would create duplicate due dates." },
        409
      );
    }
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update bill occurrence",
      },
      500
    );
  }
});

// DELETE /api/bills/:id - Delete a bill occurrence with recurrence handling and error handling
app.delete("/api/bills/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const { deleteOption } = await c.req.json<{
      deleteOption: "this" | "future";
    }>();

    // Validate deleteOption
    if (
      !deleteOption ||
      (deleteOption !== "this" && deleteOption !== "future")
    ) {
      return c.json(
        { error: "Invalid deleteOption. Choose 'this' or 'future'." },
        400
      );
    }

    // Fetch existing occurrence
    const existingOccurrenceResult = await queryDB(
      c,
      "SELECT * FROM BillOccurrence WHERE id = ?",
      [id]
    );
    if (existingOccurrenceResult.results.length === 0) {
      return c.json({ error: "Bill occurrence not found" }, 404);
    }
    const existingOccurrence: BillOccurrence = existingOccurrenceResult
      .results[0] as BillOccurrence;

    if (deleteOption === "this") {
      // Mark only this occurrence as deleted
      const sqlDeleteThis = `
        UPDATE BillOccurrence
        SET deleted = 1
        WHERE id = ?
      `;
      await c.env.D1_DATABASE.prepare(sqlDeleteThis).bind(id).run();
      return c.json({ message: "Bill occurrence deleted successfully" });
    } else if (deleteOption === "future") {
      // Mark this and future occurrences as deleted
      const sqlDeleteFuture = `
        UPDATE BillOccurrence
        SET deleted = 1
        WHERE bill_id = ? AND due_date >= ?
      `;
      await c.env.D1_DATABASE.prepare(sqlDeleteFuture)
        .bind(existingOccurrence.bill_id, existingOccurrence.due_date)
        .run();

      // Set deletedFromDate to the day after due_date
      const newDeletedFromDate = formatISO(
        addDays(parseISO(existingOccurrence.due_date), 1),
        { representation: "date" }
      );

      const sqlUpdateBill = `
        UPDATE Bill
        SET deletedFromDate = ?
        WHERE id = ?
      `;
      await c.env.D1_DATABASE.prepare(sqlUpdateBill)
        .bind(newDeletedFromDate, existingOccurrence.bill_id)
        .run();

      return c.json({
        message: "Future bill occurrences deleted successfully",
      });
    }
  } catch (error: any) {
    console.error("Error deleting bill occurrence:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete bill occurrence",
      },
      500
    );
  }
});

/**
 * Paychecks Routes
 */

// GET /api/paychecks - Retrieve all paychecks with error handling
app.get("/api/paychecks", async (c) => {
  try {
    const result = await queryDB(c, "SELECT * FROM Paycheck");
    return c.json(result.results);
  } catch (error: any) {
    console.error("Error fetching paychecks:", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch paychecks",
      },
      500
    );
  }
});

// POST /api/paychecks - Create a new paycheck with error handling
app.post("/api/paychecks", async (c) => {
  try {
    const { amount, date } = await c.req.json<{
      amount: number;
      date: string;
    }>();

    if (amount === undefined || !date) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Validate date format
    const parsedDate = parseISO(date);
    if (isNaN(parsedDate.getTime())) {
      return c.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    const newPaycheck: Paycheck = {
      id: uuidv4(),
      amount,
      date,
    };

    const sql = `
      INSERT INTO Paycheck (id, amount, date)
      VALUES (?, ?, ?)
    `;
    const params = [newPaycheck.id, newPaycheck.amount, newPaycheck.date];

    await c.env.D1_DATABASE.prepare(sql)
      .bind(...params)
      .run();
    return c.json(
      { message: "Paycheck created successfully", paycheck: newPaycheck },
      201
    );
  } catch (error: any) {
    console.error("Error creating paycheck:", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create paycheck",
      },
      500
    );
  }
});

// PUT /api/paychecks/:id - Update a paycheck with error handling
app.put("/api/paychecks/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const { amount, date } = await c.req.json<{
      amount?: number;
      date?: string;
    }>();

    // Validate date format if provided
    if (date !== undefined) {
      const parsedDate = parseISO(date);
      if (isNaN(parsedDate.getTime())) {
        return c.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
      }
    }

    const sql = `
      UPDATE Paycheck
      SET amount = COALESCE(?, amount),
          date = COALESCE(?, date)
      WHERE id = ?
    `;
    const params = [amount, date, id];

    const result = await c.env.D1_DATABASE.prepare(sql)
      .bind(...params)
      .run();
    if (result.changes === 0) {
      return c.json({ error: "Paycheck not found" }, 404);
    }
    return c.json({ message: "Paycheck updated successfully" });
  } catch (error: any) {
    console.error("Error updating paycheck:", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update paycheck",
      },
      500
    );
  }
});

// DELETE /api/paychecks/:id - Delete a paycheck with error handling
app.delete("/api/paychecks/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const sqlDelete = `
      DELETE FROM Paycheck
      WHERE id = ?
    `;

    const result = await c.env.D1_DATABASE.prepare(sqlDelete).bind(id).run();
    if (result.changes === 0) {
      return c.json({ error: "Paycheck not found" }, 404);
    }
    return c.json({ message: "Paycheck deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting paycheck:", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete paycheck",
      },
      500
    );
  }
});

/**
 * Todos Routes
 */

// GET /api/todos - Retrieve all todos with error handling
app.get("/api/todos", async (c) => {
  try {
    const result = await queryDB(c, "SELECT * FROM Todo");
    return c.json(result.results);
  } catch (error: any) {
    console.error("Error fetching todos:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch todos",
      },
      500
    );
  }
});

// POST /api/todos - Create a new todo with error handling
app.post("/api/todos", async (c) => {
  try {
    const { task, dueDate } = await c.req.json<{
      task: string;
      dueDate: string;
    }>();

    if (!task || !dueDate) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Validate dueDate format
    const parsedDueDate = parseISO(dueDate);
    if (isNaN(parsedDueDate.getTime())) {
      return c.json({ error: "Invalid dueDate format. Use YYYY-MM-DD." }, 400);
    }

    const newTodo: Todo = {
      id: uuidv4(),
      task,
      completed: false,
      dueDate,
    };

    const sql = `
      INSERT INTO Todo (id, task, dueDate, completed)
      VALUES (?, ?, ?, ?)
    `;
    const params = [
      newTodo.id,
      newTodo.task,
      newTodo.dueDate,
      newTodo.completed ? 1 : 0,
    ];

    await c.env.D1_DATABASE.prepare(sql)
      .bind(...params)
      .run();
    return c.json({ message: "Todo created successfully", todo: newTodo }, 201);
  } catch (error: any) {
    console.error("Error creating todo:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to create todo",
      },
      500
    );
  }
});

// PUT /api/todos/:id - Update a todo with error handling
app.put("/api/todos/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const { task, dueDate, completed } = await c.req.json<{
      task?: string;
      dueDate?: string;
      completed?: boolean;
    }>();

    // Validate dueDate format if provided
    if (dueDate !== undefined) {
      const parsedDueDate = parseISO(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        return c.json(
          { error: "Invalid dueDate format. Use YYYY-MM-DD." },
          400
        );
      }
    }

    let sql = `UPDATE Todo SET `;
    const updates: string[] = [];
    const params: any[] = [];

    if (task !== undefined) {
      updates.push("task = ?");
      params.push(task);
    }
    if (dueDate !== undefined) {
      updates.push("dueDate = ?");
      params.push(dueDate);
    }
    if (completed !== undefined) {
      updates.push("completed = ?");
      params.push(completed ? 1 : 0); // Convert boolean to integer
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    sql += updates.join(", ") + " WHERE id = ?";
    params.push(id);

    const result = await c.env.D1_DATABASE.prepare(sql)
      .bind(...params)
      .run();

    if (result.changes === 0) {
      return c.json({ error: "Todo not found" }, 404);
    }
    return c.json({ message: "Todo updated successfully" });
  } catch (error: any) {
    console.error("Error updating todo:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to update todo",
      },
      500
    );
  }
});

// DELETE /api/todos/:id - Delete a todo with error handling
app.delete("/api/todos/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const sqlDelete = `
      DELETE FROM Todo
      WHERE id = ?
    `;

    const result = await c.env.D1_DATABASE.prepare(sqlDelete).bind(id).run();
    if (result.changes === 0) {
      return c.json({ error: "Todo not found" }, 404);
    }
    return c.json({ message: "Todo deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting todo:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete todo",
      },
      500
    );
  }
});

// Export the Hono app as the default export
export default app;
