"use server";
import { getRequestContext } from "@rshono/core/server";
let count = 0;
export async function incrementServerCounter(amount: number): Promise<number> {
  // Demonstration credential only. Real apps must validate a session/token and authorize each mutation.
  if (getRequestContext().req.header("authorization") !== "Bearer example")
    throw new Error("Unauthorized");
  if (!Number.isInteger(amount) || amount < 1 || amount > 5) throw new Error("Invalid increment");
  count += amount;
  return count;
}
export async function readServerCounter(): Promise<number> {
  return count;
}
