import { describe, it, expect } from "vitest";
import { isPrivateIp } from "../src/lib/musicLibrary.js";

describe("anti-SSRF / isPrivateIp", () => {
  it("bloquea IPs internas, loopback, link-local y metadata cloud", () => {
    for (const ip of [
      "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254",     // metadata de AWS/GCP/Azure
      "100.64.0.1",          // CGNAT
      "0.0.0.0",
      "::1", "fe80::1", "fc00::1", "fd12:3456::1",
      "::ffff:127.0.0.1",    // IPv4 mapeada en IPv6
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("permite IPs públicas normales", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("172.15/172.32 NO son privadas (borde del rango 172.16-31)", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });
});
