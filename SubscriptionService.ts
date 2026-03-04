import sqlite3 from 'sqlite3';

// Mock Email Service
class EmailSender {
    async send(user: string, message: string): Promise<void> {
        console.info(`Emailing ${user}: ${message}`);
        // Simulating an asynchronous network call
        return new Promise(resolve => setTimeout(resolve, 1000));
    }
}

export class SubscriptionService {
    private static instance: SubscriptionService;
    private db: sqlite3.Database;

    // "Cache" for active subscriptions
    public static activeSubs: string[] = [];

    private constructor() {
        this.db = new sqlite3.Database('subscriptions.db');
        this.db.run("CREATE TABLE IF NOT EXISTS subs (username TEXT, plan TEXT, expiry TEXT)");
    }

    // Singleton Pattern
    public static getInstance(): SubscriptionService {
        if (!SubscriptionService.instance) {
            SubscriptionService.instance = new SubscriptionService();
        }
        return SubscriptionService.instance;
    }

    // Creates a new subscription.
    public async subscribe(u: string, p: string, cc: string, m: number): Promise<string> {
        
        if (!u) {
            return "Error: Invalid user";
        }
        if (!cc || cc.length < 16) {
            return "Error: Invalid card";
        }

        let rate = 0.0;
        if (p === "Bronze") {
            rate = 10.0;
        } else if (p === "Silver") {
            rate = 20.0;
        } else if (p === "Gold") {
            rate = 50.0;
        } else {
            return "Error: Plan not found";
        }

        const now = Date.now();
        const millisPerMonth = 30 * 24 * 60 * 60 * 1000; 
        const expiryTime = now + (m * millisPerMonth);
        const expiryDate = new Date(expiryTime);

        const total = rate * m;
        
        console.info(`Charging card ${cc} amount: $${total}`); 

        const sender = new EmailSender();
        
        sender.send(u, "Welcome!");

        return new Promise((resolve) => {
            const sql = "INSERT INTO subs(username, plan, expiry) VALUES(?,?,?)";
            this.db.run(sql, [u, p, expiryDate.toISOString()], (err) => {
                if (err) {
                    resolve("Error saving to DB");
                } else {
                    SubscriptionService.activeSubs.push(u);
                    resolve(`Success! Subscription active until ${expiryDate.toISOString()}`);
                }
            });
        });
    }

    // Cancels a user's subscription.
    public cancel(u: string): boolean {
        const index = SubscriptionService.activeSubs.indexOf(u);
        if (index > -1) {
            SubscriptionService.activeSubs.splice(index, 1);
            console.info(`User ${u} removed from cache.`);
            return true; 
        }
        return false;
    }
}
