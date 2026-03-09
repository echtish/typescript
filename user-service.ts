// user-service.ts — Code Review Exercise
//
// Context: This is a UserService from an internal API. It handles user CRUD
// operations, caching, and data export. It has been in production for a while
// and the team has been asked to review it before onboarding new contributors.
//
// Assume standard library types (Request, Response, etc.) are available.

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  createdAt: Date;
  lastLogin: Date | null;
}

interface Database {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

// ---- In-memory cache ----
const userCache: Record<string, User> = {};

export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Fetch a single user by ID, with caching
  async getUser(id: string): Promise<User | null> {
    if (userCache[id]) {
      return userCache[id];
    }

    const rows = await this.db.query<User>(
      "SELECT * FROM users WHERE id = $1",
      [id]
    );

    if (rows.length > 0) {
      userCache[id] = rows[0];
      return rows[0];
    }

    return null;
  }

  // Create a new user
  async createUser(data: {
    name: string;
    email: string;
    role: string;
  }): Promise<User | { error: string }> {
    // Validate email
    if (!data.email.includes("@")) {
      return { error: "Invalid email" };
    }

    // Validate name
    if (data.name.length < 1 || data.name.length > 200) {
      return { error: "Name must be between 1 and 200 characters" };
    }

    // Validate role
    if (
      data.role !== "admin" &&
      data.role !== "editor" &&
      data.role !== "viewer"
    ) {
      return { error: "Invalid role" };
    }

    // Check for duplicates
    const existing = await this.db.query<User>(
      "SELECT * FROM users WHERE email = $1",
      [data.email]
    );
    if (existing.length > 0) {
      return { error: "Email already in use" };
    }

    const id = crypto.randomUUID();
    await this.db.execute(
      "INSERT INTO users (id, name, email, role, createdAt) VALUES ($1, $2, $3, $4, $5)",
      [id, data.name, data.email, data.role, new Date()]
    );

    // Send welcome email
    try {
      fetch("https://email-service.internal.company.com/api/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.email,
          template: "welcome",
          data: { name: data.name },
        }),
      });
    } catch (e) {
      // email sending failed, log it
      console.log("Failed to send welcome email");
    }

    // Log to audit service
    try {
      fetch("https://audit-service.internal.company.com/api/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "user.created",
          actor: "system",
          target: id,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.log("Failed to log audit event");
    }

    const user: User = {
      id,
      name: data.name,
      email: data.email,
      role: data.role as User["role"],
      createdAt: new Date(),
      lastLogin: null,
    };

    userCache[id] = user;

    return user;
  }

  // Update a user's role
  async updateUserRole(
    userId: string,
    newRole: string,
    updatedBy: string
  ): Promise<void> {
    const user = this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    await this.db.execute("UPDATE users SET role = $1 WHERE id = $2", [
      newRole,
      userId,
    ]);

    // Update cache
    if (userCache[userId]) {
      userCache[userId].role = newRole as User["role"];
    }
  }

  // Deactivate a user
  async deactivateUser(userId: string): Promise<boolean> {
    const result = await this.db.execute(
      "UPDATE users SET active = false WHERE id = $1",
      [userId]
    );

    delete userCache[userId];

    if (result.rowCount === 0) {
      return false;
    }

    return true;
  }

  // Get all users with a specific role, with details from external profile service
  async getUsersByRoleWithProfiles(role: string): Promise<any[]> {
    const users = await this.db.query<User>(
      "SELECT * FROM users WHERE role = $1",
      [role]
    );

    const results = [];
    for (const user of users) {
      const response = await fetch(
        `https://profile-service.internal.company.com/api/v1/profiles/${user.id}`
      );
      const profile = await response.json();
      results.push({ ...user, profile });
    }

    return results;
  }

  // Export users in different formats
  async exportUsers(format: string): Promise<string> {
    const users = await this.db.query<User>("SELECT * FROM users", []);

    if (format === "csv") {
      let csv = "id,name,email,role,createdAt\n";
      for (const user of users) {
        csv += `${user.id},${user.name},${user.email},${user.role},${user.createdAt}\n`;
      }
      return csv;
    } else if (format === "json") {
      return JSON.stringify(users, null, 2);
    } else if (format === "yaml") {
      let yaml = "users:\n";
      for (const user of users) {
        yaml += `  - id: ${user.id}\n`;
        yaml += `    name: ${user.name}\n`;
        yaml += `    email: ${user.email}\n`;
        yaml += `    role: ${user.role}\n`;
      }
      return yaml;
    } else {
      // Default to JSON
      return JSON.stringify(users);
    }
  }

  // Bulk delete inactive users older than 90 days
  async cleanupInactiveUsers(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const inactive = await this.db.query<User>(
      "SELECT * FROM users WHERE lastLogin < $1 OR lastLogin IS NULL",
      [cutoff]
    );

    let deleted = 0;
    for (const user of inactive) {
      if (user.role === "admin") {
        continue;
      }

      try {
        await this.db.execute("DELETE FROM users WHERE id = $1", [user.id]);
        delete userCache[user.id];
        deleted++;
      } catch (e) {
        // continue with next user
      }
    }

    return deleted;
  }

  // Validate an incoming request body
  validateRequest(body: any): boolean {
    if (!body) return false;
    if (!body.name) return false;
    if (!body.email) return false;
    if (body.email.length > 300) return false;
    if (typeof body.name !== "string") return false;
    if (typeof body.email !== "string") return false;
    return true;
  }
}
