import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./shared/migrations",
  dialect: "postgresql",
});
