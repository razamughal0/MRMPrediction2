import { db } from "@/db";
import { users, studentProfiles, facultyProfiles, adminProfiles, auditLogs } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { verifyPassword, createSession, DASHBOARD_ROUTE_BY_ROLE } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<SessionPayload["role"], string> = {
  student: "Student Portal",
  faculty: "Faculty Portal",
  admin: "Administration Portal",
  super_admin: "Super Admin Console",
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password, expectedRole, remember = true } = body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Email/username and password are required" }, { status: 400 });
    }

    const identifier = email.toLowerCase().trim();

    const [user] = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.email, identifier),
          eq(users.username, email.trim()),
          eq(users.username, identifier)
        )
      )
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid email/username or password" }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json({ error: "Account is deactivated" }, { status: 403 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email/username or password" }, { status: 401 });
    }

    // Validate expected portal role on the server before issuing session
    if (expectedRole && user.role !== expectedRole) {
      const targetPortal = ROLE_LABELS[user.role] || user.role;
      return NextResponse.json(
        {
          error: `This account belongs to the ${targetPortal}. Please sign in from the ${targetPortal} login page.`,
        },
        { status: 403 }
      );
    }

    // Verify profile exists for non-super-admin
    if (user.role === "student") {
      const [p] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, user.id)).limit(1);
      if (!p) return NextResponse.json({ error: "Student profile not found" }, { status: 403 });
    } else if (user.role === "faculty") {
      const [p] = await db.select().from(facultyProfiles).where(eq(facultyProfiles.userId, user.id)).limit(1);
      if (!p) return NextResponse.json({ error: "Faculty profile not found" }, { status: 403 });
    } else if (user.role === "admin") {
      const [p] = await db.select().from(adminProfiles).where(eq(adminProfiles.userId, user.id)).limit(1);
      if (!p) return NextResponse.json({ error: "Admin profile not found" }, { status: 403 });
    }

    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };

    const token = await createSession(payload, Boolean(remember));

    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    // Audit log
    await db.insert(auditLogs).values({
      userId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      metadata: { role: user.role },
    });

    return NextResponse.json(
      {
        ok: true,
        role: user.role,
        redirectTo: DASHBOARD_ROUTE_BY_ROLE[user.role],
        token,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (e) {
    console.error("Login error:", e);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
