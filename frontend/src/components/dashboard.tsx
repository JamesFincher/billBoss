"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Edit2,
  ChevronLeft,
  ChevronRight,
  SkipForward,
} from "lucide-react";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  parseISO,
  isSameDay,
  addMonths,
} from "date-fns";

// Updated Bill interface to match BillOccurrence from the backend
interface Bill {
  id: string; // Unique identifier for the occurrence
  bill_id: string; // References the Bill series
  name: string;
  amount: number;
  is_paid: boolean;
  paid_date: string | null;
  due_date: string;
  status: "upcoming" | "completed" | "missed" | "skipped";
  deleted: boolean;
}

interface Todo {
  id: string;
  task: string;
  completed: boolean;
  dueDate: string;
}

interface Paycheck {
  id: string;
  amount: number;
  date: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export function DashboardComponent() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [paychecks, setPaychecks] = useState<Paycheck[]>([]);

  const [newBill, setNewBill] = useState({
    name: "",
    amount: "",
    dueDate: "",
    recurrence: "none",
  });
  const [newTodo, setNewTodo] = useState({ task: "", dueDate: "" });
  const [newPaycheck, setNewPaycheck] = useState({ amount: "", date: "" });

  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [billToDelete, setBillToDelete] = useState<Bill | null>(null);

  // **New State Variables for Error Handling and Loading States**
  const [error, setError] = useState<string | null>(null);
  const [loadingBills, setLoadingBills] = useState(false);
  const [loadingTodos, setLoadingTodos] = useState(false);
  const [loadingPaychecks, setLoadingPaychecks] = useState(false);

  // Function to fetch all data from the backend
  const fetchData = useCallback(async () => {
    try {
      setLoadingBills(true);
      setLoadingTodos(true);
      setLoadingPaychecks(true);
      setError(null);

      const formattedMonth = format(currentMonth, "yyyy-MM");
      const [billsRes, todosRes, paychecksRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/bills?month=${formattedMonth}`),
        fetch(`${API_BASE_URL}/api/todos`),
        fetch(`${API_BASE_URL}/api/paychecks`),
      ]);

      if (!billsRes.ok || !todosRes.ok || !paychecksRes.ok) {
        throw new Error("Failed to fetch data from the server.");
      }

      const [billsData, todosData, paychecksData] = await Promise.all([
        billsRes.json(),
        todosRes.json(),
        paychecksRes.json(),
      ]);

      setBills(
        billsData.map((bill: any) => ({
          ...bill,
          is_paid: Boolean(bill.is_paid),
          skipped: bill.status === "skipped",
          deleted: Boolean(bill.deleted),
        }))
      );

      setTodos(
        todosData.map((todo: Todo) => ({
          ...todo,
          completed: Boolean(todo.completed),
        }))
      );

      setPaychecks(paychecksData);
    } catch (error: any) {
      console.error("Error fetching data:", error);
      setError(error.message || "An unexpected error occurred.");
    } finally {
      setLoadingBills(false);
      setLoadingTodos(false);
      setLoadingPaychecks(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter bills for the current month
  const monthlyBills = useCallback(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);

    return bills.filter((bill: Bill) =>
      isWithinInterval(parseISO(bill.due_date), {
        start: monthStart,
        end: monthEnd,
      })
    );
  }, [bills, currentMonth]);

  // Add Bill
  const addBill = async () => {
    if (newBill.name && newBill.amount && newBill.dueDate) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/bills`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: newBill.name,
            amount: parseFloat(newBill.amount),
            dueDate: newBill.dueDate,
            recurrence: newBill.recurrence,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          alert("Bill added successfully!");
          setNewBill({ name: "", amount: "", dueDate: "", recurrence: "none" });
          fetchData();
        } else if (response.status === 409) {
          const errorData = await response.json();
          alert(`Error: ${errorData.error}`);
        } else {
          const errorData = await response.json();
          alert(`Error: ${errorData.error}`);
        }
      } catch (error: any) {
        console.error("Error adding bill:", error);
        alert(error.message || "Failed to add bill.");
      }
    } else {
      alert("All bill fields are required.");
    }
  };

  // Update Bill
  const updateBill = async (
    id: string,
    updates: Partial<Bill>,
    updateOption: "this" | "future"
  ) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/bills/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...updates,
          updateOption,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        alert("Bill updated successfully!");
        setEditingBill(null);
        fetchData();
      } else {
        const errorData = await response.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (error: any) {
      console.error("Error updating bill:", error);
      alert(error.message || "Failed to update bill.");
    }
  };

  // Delete Bill
  const deleteBill = async (id: string, deleteOption: "this" | "future") => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/bills/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deleteOption }),
      });

      if (response.ok) {
        const data = await response.json();
        alert("Bill deleted successfully!");
        setShowDeleteDialog(false);
        setBillToDelete(null);
        fetchData(); // Refresh the bills list
      } else {
        const errorData = await response.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (error: any) {
      console.error("Error deleting bill:", error);
      alert(error.message || "Failed to delete bill.");
    }
  };

  // Skip Bill (Mark as skipped)
  const skipBill = async (id: string) => {
    try {
      await updateBill(id, { status: "skipped" }, "this");
    } catch (error) {
      // Error is handled in updateBill
    }
  };

  // Add Todo
  const addTodo = async () => {
    if (newTodo.task && newTodo.dueDate) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/todos`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task: newTodo.task,
            dueDate: newTodo.dueDate,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          alert("Todo added successfully!");
          setNewTodo({ task: "", dueDate: "" });
          fetchData();
        } else {
          const errorData = await response.json();
          alert(`Error: ${errorData.error}`);
        }
      } catch (error: any) {
        console.error("Error adding todo:", error);
        alert(error.message || "Failed to add todo.");
      }
    } else {
      alert("All todo fields are required.");
    }
  };

  // Update Todo
  const updateTodo = async (id: string, updates: Partial<Todo>) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/todos/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        const data = await response.json();
        alert("Todo updated successfully!");
        setEditingTodo(null);
        fetchData();
      } else {
        const errorData = await response.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (error: any) {
      console.error("Error updating todo:", error);
      alert(error.message || "Failed to update todo.");
    }
  };

  // Delete Todo
  const deleteTodo = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/todos/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        alert("Todo deleted successfully!");
        fetchData();
      } else {
        const errorData = await response.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (error: any) {
      console.error("Error deleting todo:", error);
      alert(error.message || "Failed to delete todo.");
    }
  };

  // Add Paycheck
  const addPaycheck = async () => {
    if (newPaycheck.amount && newPaycheck.date) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/paychecks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: parseFloat(newPaycheck.amount),
            date: newPaycheck.date,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          alert("Paycheck added successfully!");
          setNewPaycheck({ amount: "", date: "" });
          fetchData();
        } else {
          const errorData = await response.json();
          alert(`Error: ${errorData.error}`);
        }
      } catch (error: any) {
        console.error("Error adding paycheck:", error);
        alert(error.message || "Failed to add paycheck.");
      }
    } else {
      alert("All paycheck fields are required.");
    }
  };

  // Delete Paycheck
  const deletePaycheck = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/paychecks/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        alert("Paycheck deleted successfully!");
        fetchData();
      } else {
        const errorData = await response.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (error: any) {
      console.error("Error deleting paycheck:", error);
      alert(error.message || "Failed to delete paycheck.");
    }
  };

  // Calculate summaries
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const filteredMonthlyBills = monthlyBills();

  const monthlyTodos = todos.filter((todo: Todo) =>
    isWithinInterval(parseISO(todo.dueDate), {
      start: monthStart,
      end: monthEnd,
    })
  );

  const totalBills = filteredMonthlyBills.reduce(
    (sum: number, bill: Bill) =>
      sum + (!bill.status || bill.status === "skipped" ? 0 : bill.amount),
    0
  );

  const unpaidBills = filteredMonthlyBills
    .filter(
      (bill: Bill) => bill.status !== "completed" && bill.status !== "skipped"
    )
    .reduce((sum: number, bill: Bill) => sum + bill.amount, 0);

  const completedTodos = monthlyTodos.filter(
    (todo: Todo) => todo.completed
  ).length;

  const monthlyPaychecks = paychecks.filter((paycheck: Paycheck) =>
    isWithinInterval(parseISO(paycheck.date), {
      start: monthStart,
      end: monthEnd,
    })
  );

  const totalPaychecks = monthlyPaychecks.reduce(
    (sum: number, paycheck: Paycheck) => sum + paycheck.amount,
    0
  );

  const balance = totalPaychecks - totalBills;

  const weekStart = startOfWeek(currentMonth);
  const weekEnd = endOfWeek(currentMonth);

  const weeklyBills = filteredMonthlyBills
    .filter((bill: Bill) =>
      isWithinInterval(parseISO(bill.due_date), {
        start: weekStart,
        end: weekEnd,
      })
    )
    .reduce(
      (sum: number, bill: Bill) =>
        sum + (!bill.status || bill.status === "skipped" ? 0 : bill.amount),
      0
    );

  const weeklyPaychecks = monthlyPaychecks
    .filter((paycheck: Paycheck) =>
      isWithinInterval(parseISO(paycheck.date), {
        start: weekStart,
        end: weekEnd,
      })
    )
    .reduce((sum: number, paycheck: Paycheck) => sum + paycheck.amount, 0);

  const weeklyBalance = weeklyPaychecks - weeklyBills;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Personal Finance Dashboard</h1>
      <div className="flex justify-between items-center mb-4">
        <Button
          onClick={() => {
            setCurrentMonth((prevMonth) => addMonths(prevMonth, -1));
          }}
          disabled={loadingBills || loadingTodos || loadingPaychecks}
        >
          <ChevronLeft />
        </Button>
        <h2 className="text-xl font-semibold">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <Button
          onClick={() => {
            setCurrentMonth((prevMonth) => addMonths(prevMonth, 1));
          }}
          disabled={loadingBills || loadingTodos || loadingPaychecks}
        >
          <ChevronRight />
        </Button>
      </div>
      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
          Error: {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Bills Card */}
        <Card>
          <CardHeader>
            <CardTitle>Bills</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px] mb-4">
              {loadingBills ? (
                <p className="text-gray-500">Loading bills...</p>
              ) : filteredMonthlyBills.length === 0 ? (
                <p className="text-gray-500">No bills for this month.</p>
              ) : (
                filteredMonthlyBills.map((bill: Bill) => (
                  <div
                    key={bill.id}
                    className={`flex justify-between items-center mb-2 ${
                      bill.status === "skipped" ? "opacity-50" : ""
                    }`}
                  >
                    {editingBill && editingBill.id === bill.id ? (
                      <>
                        <Input
                          value={editingBill.name}
                          onChange={(e) =>
                            setEditingBill({
                              ...editingBill,
                              name: e.target.value,
                            })
                          }
                          className="w-1/4 mr-2"
                          placeholder="Bill Name"
                        />
                        <Input
                          type="number"
                          value={editingBill.amount}
                          onChange={(e) =>
                            setEditingBill({
                              ...editingBill,
                              amount: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-1/6 mr-2"
                          placeholder="Amount"
                        />
                        <Input
                          type="date"
                          value={editingBill.due_date}
                          onChange={(e) =>
                            setEditingBill({
                              ...editingBill,
                              due_date: e.target.value,
                            })
                          }
                          className="w-1/4 mr-2"
                        />
                        <Select
                          value={editingBill.status}
                          onValueChange={(value) =>
                            setEditingBill({
                              ...editingBill,
                              status: value as Bill["status"],
                            })
                          }
                          className="w-1/6 mr-2"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="upcoming">Upcoming</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="missed">Missed</SelectItem>
                            <SelectItem value="skipped">Skipped</SelectItem>
                          </SelectContent>
                        </Select>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button className="mr-2">Save</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Update Bill</DialogTitle>
                              <DialogDescription>
                                Do you want to update only this bill or all
                                future occurrences?
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <Button
                                onClick={() => {
                                  updateBill(bill.id, editingBill, "this");
                                }}
                              >
                                Update This Bill
                              </Button>
                              <Button
                                onClick={() => {
                                  updateBill(bill.id, editingBill, "future");
                                }}
                              >
                                Update All Future Bills
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingBill(null)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1">
                          <span
                            className={`block ${
                              bill.status === "skipped" ? "line-through" : ""
                            }`}
                          >
                            {bill.name}
                          </span>
                          <span
                            className={`block ${
                              bill.status === "skipped" ? "line-through" : ""
                            }`}
                          >
                            ${bill.amount.toFixed(2)}
                          </span>
                          <span className="block text-sm text-gray-500">
                            Due: {format(parseISO(bill.due_date), "MMM dd")}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={bill.is_paid}
                            onCheckedChange={(checked) =>
                              updateBill(bill.id, { is_paid: checked }, "this")
                            }
                            disabled={bill.status === "skipped"}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingBill(bill)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => skipBill(bill.id)}
                            disabled={bill.status === "skipped"}
                          >
                            <SkipForward className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (bill.status !== "skipped") {
                                setBillToDelete(bill);
                                setShowDeleteDialog(true);
                              }
                            }}
                            disabled={bill.status === "skipped"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </ScrollArea>
            <div className="flex flex-col gap-2">
              <Input
                placeholder="Bill Name"
                value={newBill.name}
                onChange={(e) =>
                  setNewBill({ ...newBill, name: e.target.value })
                }
              />
              <Input
                type="number"
                placeholder="Amount"
                value={newBill.amount}
                onChange={(e) =>
                  setNewBill({ ...newBill, amount: e.target.value })
                }
              />
              <Input
                type="date"
                value={newBill.dueDate}
                onChange={(e) =>
                  setNewBill({ ...newBill, dueDate: e.target.value })
                }
              />
              <Select
                value={newBill.recurrence}
                onValueChange={(value) =>
                  setNewBill({ ...newBill, recurrence: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Recurrence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={addBill}
                disabled={
                  !newBill.name ||
                  !newBill.amount ||
                  !newBill.dueDate ||
                  loadingBills
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Bill
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Todo List Card */}
        <Card>
          <CardHeader>
            <CardTitle>Todo List</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px] mb-4">
              {loadingTodos ? (
                <p className="text-gray-500">Loading todos...</p>
              ) : monthlyTodos.length === 0 ? (
                <p className="text-gray-500">No todos for this month.</p>
              ) : (
                monthlyTodos.map((todo: Todo) => (
                  <div
                    key={todo.id}
                    className={`flex items-center mb-2 ${
                      todo.completed ? "opacity-50" : ""
                    }`}
                  >
                    {editingTodo && editingTodo.id === todo.id ? (
                      <>
                        <Input
                          value={editingTodo.task}
                          onChange={(e) =>
                            setEditingTodo({
                              ...editingTodo,
                              task: e.target.value,
                            })
                          }
                          className="w-2/5 mr-2"
                          placeholder="Task"
                        />
                        <Input
                          type="date"
                          value={editingTodo.dueDate}
                          onChange={(e) =>
                            setEditingTodo({
                              ...editingTodo,
                              dueDate: e.target.value,
                            })
                          }
                          className="w-1/3 mr-2"
                        />
                        <Button
                          onClick={() => {
                            updateTodo(todo.id, editingTodo);
                          }}
                          className="mr-2"
                          disabled={
                            !editingTodo.task ||
                            !editingTodo.dueDate ||
                            loadingTodos
                          }
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingTodo(null)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Switch
                          checked={todo.completed}
                          onCheckedChange={(checked) =>
                            updateTodo(todo.id, { completed: checked })
                          }
                          className="mr-2"
                          disabled={loadingTodos}
                        />
                        <div className="flex-1">
                          <span
                            className={`block ${
                              todo.completed ? "line-through" : ""
                            }`}
                          >
                            {todo.task}
                          </span>
                          <span className="block text-sm text-gray-500">
                            Due: {format(parseISO(todo.dueDate), "MMM dd")}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingTodo(todo)}
                          className="mr-2"
                          disabled={loadingTodos}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteTodo(todo.id)}
                          disabled={loadingTodos}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
            </ScrollArea>
            <div className="flex flex-col gap-2">
              <Input
                placeholder="New Todo"
                value={newTodo.task}
                onChange={(e) =>
                  setNewTodo({ ...newTodo, task: e.target.value })
                }
              />
              <Input
                type="date"
                value={newTodo.dueDate}
                onChange={(e) =>
                  setNewTodo({ ...newTodo, dueDate: e.target.value })
                }
              />
              <Button
                onClick={addTodo}
                disabled={!newTodo.task || !newTodo.dueDate || loadingTodos}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Todo
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold mb-2">
              Weekly ({format(weekStart, "MMM dd")} -{" "}
              {format(weekEnd, "MMM dd")})
            </h3>
            <p>Bills Due: ${weeklyBills.toFixed(2)}</p>
            <p>Paychecks: ${weeklyPaychecks.toFixed(2)}</p>
            <p>Balance: ${weeklyBalance.toFixed(2)}</p>

            <h3 className="font-semibold mt-4 mb-2">
              Monthly ({format(monthStart, "MMM dd")} -{" "}
              {format(monthEnd, "MMM dd")})
            </h3>
            <p>Total Bills: ${totalBills.toFixed(2)}</p>
            <p>Unpaid Bills: ${unpaidBills.toFixed(2)}</p>
            <p>Total Paychecks: ${totalPaychecks.toFixed(2)}</p>
            <p>Current Balance: ${balance.toFixed(2)}</p>
            <p>
              Completed Todos: {completedTodos} / {monthlyTodos.length}
            </p>
            <p>
              Financial Health: {balance < 0 ? "Review spending" : "On track"}
            </p>
          </CardContent>
        </Card>

        {/* Paychecks Card */}
        <Card>
          <CardHeader>
            <CardTitle>Paychecks</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[150px] mb-4">
              {loadingPaychecks ? (
                <p className="text-gray-500">Loading paychecks...</p>
              ) : monthlyPaychecks.length === 0 ? (
                <p className="text-gray-500">No paychecks for this month.</p>
              ) : (
                monthlyPaychecks.map((paycheck: Paycheck) => (
                  <div
                    key={paycheck.id}
                    className="flex justify-between items-center mb-2"
                  >
                    <span>
                      {format(parseISO(paycheck.date), "MMM dd, yyyy")}
                    </span>
                    <span>${paycheck.amount.toFixed(2)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deletePaycheck(paycheck.id)}
                      disabled={loadingPaychecks}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </ScrollArea>
            <div className="flex flex-col gap-2">
              <Input
                type="number"
                placeholder="Paycheck Amount"
                value={newPaycheck.amount}
                onChange={(e) =>
                  setNewPaycheck({ ...newPaycheck, amount: e.target.value })
                }
              />
              <Input
                type="date"
                value={newPaycheck.date}
                onChange={(e) =>
                  setNewPaycheck({ ...newPaycheck, date: e.target.value })
                }
              />
              <Button
                onClick={addPaycheck}
                disabled={
                  !newPaycheck.amount || !newPaycheck.date || loadingPaychecks
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Paycheck
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete Bill Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bill</DialogTitle>
            <DialogDescription>
              Do you want to delete only this bill or all future occurrences?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                if (billToDelete) {
                  deleteBill(billToDelete.id, "this");
                }
              }}
              disabled={!billToDelete}
            >
              Delete This Bill
            </Button>
            <Button
              onClick={() => {
                if (billToDelete) {
                  deleteBill(billToDelete.id, "future");
                }
              }}
              disabled={!billToDelete}
            >
              Delete All Future Bills
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
