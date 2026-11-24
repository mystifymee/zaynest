import "./env.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL не найден");
}

const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 });

export const prisma = new PrismaClient({ adapter });
