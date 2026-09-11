const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'tasks.db');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite Database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at', DB_PATH);
    initDb();
  }
});

// Helper promise wrappers for sqlite3
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Initialize Database Tables & Initial Seed Data if Empty
async function initDb() {
  const createTodosTableSql = `
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium',
      category TEXT DEFAULT 'general',
      due_date TEXT,
      completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const createUsersTableSql = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'Member',
      department TEXT DEFAULT 'General',
      status TEXT DEFAULT 'Active',
      avatar_color TEXT DEFAULT '#6366f1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await dbRun(createTodosTableSql);
    await dbRun(createUsersTableSql);

    // Seed todos if empty
    const countTodosRow = await dbGet('SELECT COUNT(*) as count FROM todos');
    if (countTodosRow && countTodosRow.count === 0) {
      console.log('Seeding initial tasks into database...');
      const seedTodos = [
        ['Design application interface', 'Create responsive glassmorphism UI layout and theme', 'high', 'Design', '2026-09-15', 1],
        ['Build REST API backend', 'Implement Express endpoints with SQLite database queries', 'high', 'Development', '2026-09-12', 1],
        ['Implement task filtering & search', 'Filter tasks by completion status, priority, and text search', 'medium', 'Development', '2026-09-18', 0],
        ['Review & test project setup', 'Verify frontend and backend API communication', 'low', 'Testing', '2026-09-20', 0]
      ];

      for (const task of seedTodos) {
        await dbRun(
          `INSERT INTO todos (title, description, priority, category, due_date, completed) VALUES (?, ?, ?, ?, ?, ?)`,
          task
        );
      }
      console.log('Todos database seeded successfully.');
    }

    // Seed users if empty
    const countUsersRow = await dbGet('SELECT COUNT(*) as count FROM users');
    if (countUsersRow && countUsersRow.count === 0) {
      console.log('Seeding initial users into database...');
      const seedUsers = [
        ['Alex Johnson', 'alex@taskflow.dev', 'Admin', 'Engineering', 'Active', '#6366f1'],
        ['Sarah Chen', 'sarah@taskflow.dev', 'Lead Developer', 'Development', 'Active', '#38bdf8'],
        ['Marcus Vance', 'marcus@taskflow.dev', 'UI/UX Designer', 'Design', 'Active', '#f59e0b'],
        ['Elena Rostova', 'elena@taskflow.dev', 'Product Manager', 'Management', 'Active', '#10b981']
      ];

      for (const user of seedUsers) {
        await dbRun(
          `INSERT INTO users (name, email, role, department, status, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`,
          user
        );
      }
      console.log('Users database seeded successfully.');
    }
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

// ==================== REST API ENDPOINTS ==================== //

// GET /api/todos - List todos with optional search, category, status, priority filtering
app.get('/api/todos', async (req, res) => {
  try {
    const { search, category, status, priority } = req.query;
    let sql = 'SELECT * FROM todos WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category && category !== 'all') {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (priority && priority !== 'all') {
      sql += ' AND priority = ?';
      params.push(priority);
    }

    if (status === 'completed') {
      sql += ' AND completed = 1';
    } else if (status === 'pending') {
      sql += ' AND completed = 0';
    }

    sql += ' ORDER BY completed ASC, CASE priority WHEN "high" THEN 1 WHEN "medium" THEN 2 WHEN "low" THEN 3 ELSE 4 END, id DESC';

    const todos = await dbAll(sql, params);
    res.json(todos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/stats - Overview summary statistics
app.get('/api/todos/stats', async (req, res) => {
  try {
    const totalRow = await dbGet('SELECT COUNT(*) as total FROM todos');
    const completedRow = await dbGet('SELECT COUNT(*) as completed FROM todos WHERE completed = 1');
    const pendingRow = await dbGet('SELECT COUNT(*) as pending FROM todos WHERE completed = 0');
    const highRow = await dbGet('SELECT COUNT(*) as high FROM todos WHERE priority = "high" AND completed = 0');
    
    // Categories list
    const categoriesRows = await dbAll('SELECT DISTINCT category FROM todos WHERE category IS NOT NULL AND category != ""');
    const categories = categoriesRows.map(r => r.category);

    res.json({
      total: totalRow ? totalRow.total : 0,
      completed: completedRow ? completedRow.completed : 0,
      pending: pendingRow ? pendingRow.pending : 0,
      highPriority: highRow ? highRow.high : 0,
      categories: categories
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/:id - Single todo
app.get('/api/todos/:id', async (req, res) => {
  try {
    const todo = await dbGet('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    if (!todo) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(todo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/todos - Create a new todo
app.post('/api/todos', async (req, res) => {
  try {
    const { title, description, priority, category, due_date } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    const taskPriority = priority || 'medium';
    const taskCategory = category && category.trim() ? category.trim() : 'General';

    const result = await dbRun(
      `INSERT INTO todos (title, description, priority, category, due_date) VALUES (?, ?, ?, ?, ?)`,
      [title.trim(), description ? description.trim() : '', taskPriority, taskCategory, due_date || null]
    );

    const newTodo = await dbGet('SELECT * FROM todos WHERE id = ?', [result.lastID]);
    res.status(201).json(newTodo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/todos/:id - Update an existing todo or toggle completion status
app.put('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await dbGet('SELECT * FROM todos WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const title = req.body.title !== undefined ? req.body.title.trim() : existing.title;
    const description = req.body.description !== undefined ? req.body.description.trim() : existing.description;
    const priority = req.body.priority !== undefined ? req.body.priority : existing.priority;
    const category = req.body.category !== undefined ? req.body.category.trim() : existing.category;
    const due_date = req.body.due_date !== undefined ? req.body.due_date : existing.due_date;
    const completed = req.body.completed !== undefined ? (req.body.completed ? 1 : 0) : existing.completed;

    await dbRun(
      `UPDATE todos SET title = ?, description = ?, priority = ?, category = ?, due_date = ?, completed = ? WHERE id = ?`,
      [title, description, priority, category, due_date, completed, id]
    );

    const updated = await dbGet('SELECT * FROM todos WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/completed/clear - Clear all completed tasks
app.delete('/api/todos/completed/clear', async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM todos WHERE completed = 1');
    res.json({ message: 'Completed tasks cleared', changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/:id - Delete a task
app.delete('/api/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dbRun('DELETE FROM todos WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ message: 'Task deleted successfully', id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== USER API ENDPOINTS ==================== //

// GET /api/users - List users with optional search
app.get('/api/users', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (name LIKE ? OR email LIKE ? OR role LIKE ? OR department LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY id ASC';
    const users = await dbAll(sql, params);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id - Get single user by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users - Create new user
app.post('/api/users', async (req, res) => {
  try {
    const { name, email, role, department, status, avatar_color } = req.body;
    if (!name || !name.trim() || !email || !email.trim()) {
      return res.status(400).json({ error: 'Name and Email are required' });
    }

    const avatarColors = ['#6366f1', '#38bdf8', '#f59e0b', '#10b981', '#a855f7', '#f43f5e'];
    const chosenColor = avatar_color || avatarColors[Math.floor(Math.random() * avatarColors.length)];

    const result = await dbRun(
      `INSERT INTO users (name, email, role, department, status, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), email.trim(), role || 'Member', department || 'General', status || 'Active', chosenColor]
    );

    const newUser = await dbGet('SELECT * FROM users WHERE id = ?', [result.lastID]);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id - Update an existing user
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
    const email = req.body.email !== undefined ? req.body.email.trim() : existing.email;
    const role = req.body.role !== undefined ? req.body.role : existing.role;
    const department = req.body.department !== undefined ? req.body.department.trim() : existing.department;
    const status = req.body.status !== undefined ? req.body.status : existing.status;
    const avatar_color = req.body.avatar_color !== undefined ? req.body.avatar_color : existing.avatar_color;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and Email cannot be empty' });
    }

    await dbRun(
      `UPDATE users SET name = ?, email = ?, role = ?, department = ?, status = ?, avatar_color = ? WHERE id = ?`,
      [name, email, role, department, status, avatar_color, id]
    );

    const updatedUser = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
    res.json(updatedUser);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Another user with this email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id - Delete a user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dbRun('DELETE FROM users WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted successfully', id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/login - Authenticate user
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Look up user by email or fallback to demo user
    let user = await dbGet('SELECT * FROM users WHERE email = ?', [email.trim()]);
    if (!user) {
      // Auto-create guest user for smooth experience
      const name = email.split('@')[0];
      const result = await dbRun(
        `INSERT INTO users (name, email, role, department, status) VALUES (?, ?, 'Member', 'General', 'Active')`,
        [name.charAt(0).toUpperCase() + name.slice(1), email.trim()]
      );
      user = await dbGet('SELECT * FROM users WHERE id = ?', [result.lastID]);
    }

    res.json({
      message: 'Login successful',
      token: `fake-jwt-token-${Date.now()}`,
      user: user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit SPA Routes & Fallback route
app.get(['/', '/login', '/dashboard', '/users'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Task Manager server running at http://localhost:${PORT}`);
});

