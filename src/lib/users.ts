/**
 * Usuarios del panel (login multi-usuario). Persistidos en data/users.json (fuera de git).
 * Contraseñas con scrypt + salt; verificación en tiempo constante.
 * Roles: "admin" (gestiona usuarios y contexto de empresa) y "member".
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const USERS_PATH = join(ROOT, "data", "users.json");

export type Role = "admin" | "member";

export interface User {
  id: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  createdAt: string;
}

function readAll(): { users: User[] } {
  try {
    return JSON.parse(readFileSync(USERS_PATH, "utf8"));
  } catch {
    return { users: [] };
  }
}

function writeAll(data: { users: User[] }): void {
  mkdirSync(dirname(USERS_PATH), { recursive: true });
  writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function hasUsers(): boolean {
  return readAll().users.length > 0;
}

/** Lista pública (sin hash/salt) para la UI. */
export function listUsers(): Array<{ id: string; name: string; role: Role; createdAt: string }> {
  return readAll().users.map(({ id, name, role, createdAt }) => ({ id, name, role, createdAt }));
}

export function getUserById(id: string): User | null {
  return readAll().users.find((u) => u.id === id) ?? null;
}

export function createUser(name: string, password: string, role: Role): User {
  const clean = name.trim();
  if (!/^[\p{L}\p{N} ._-]{2,40}$/u.test(clean)) throw new Error("Nombre de usuario inválido (2-40 caracteres)");
  if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
  const data = readAll();
  if (data.users.some((u) => u.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error("Ya existe un usuario con ese nombre");
  }
  const salt = randomBytes(16).toString("hex");
  const user: User = {
    id: randomBytes(6).toString("hex"),
    name: clean,
    role,
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  writeAll(data);
  return user;
}

export function verifyLogin(name: string, password: string): User | null {
  const user = readAll().users.find((u) => u.name.toLowerCase() === name.trim().toLowerCase());
  if (!user) return null;
  const a = Buffer.from(hashPassword(password, user.salt), "hex");
  const b = Buffer.from(user.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? user : null;
}

export function setPassword(id: string, password: string): void {
  if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres");
  const data = readAll();
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new Error("Usuario no encontrado");
  user.salt = randomBytes(16).toString("hex");
  user.hash = hashPassword(password, user.salt);
  writeAll(data);
}

export function deleteUser(id: string): void {
  const data = readAll();
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new Error("Usuario no encontrado");
  if (user.role === "admin" && data.users.filter((u) => u.role === "admin").length === 1) {
    throw new Error("No puedes eliminar al último administrador");
  }
  data.users = data.users.filter((u) => u.id !== id);
  writeAll(data);
}
