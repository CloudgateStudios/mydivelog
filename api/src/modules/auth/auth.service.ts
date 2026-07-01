import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SessionKind, UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import { getSessionTtlMs, SESSION_COOKIE_NAMES } from "./auth.config.js";
import { DevLoginDto } from "./auth.dto.js";
import { AuthContext, AuthRequest } from "./auth.types.js";

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  expires?: Date;
  maxAge?: number;
  domain?: string;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  getProviders() {
    return {
      google: {
        enabled: Boolean(this.configService.get<string>("GOOGLE_OAUTH_CLIENT_ID"))
      },
      apple: {
        enabled: Boolean(this.configService.get<string>("APPLE_OAUTH_CLIENT_ID"))
      },
      dev: {
        enabled: this.isDevelopment()
      }
    };
  }

  async createDevelopmentSession(dto: DevLoginDto, request: AuthRequest) {
    if (!this.isDevelopment()) {
      throw new NotFoundException();
    }

    const role = dto.role ?? UserRole.user;
    const sessionKind = dto.sessionKind ?? SessionKind.user;

    if (sessionKind === SessionKind.admin && role === UserRole.user) {
      throw new UnauthorizedException("Admin sessions require a staff or admin role.");
    }

    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        displayName: dto.displayName,
        role
      },
      create: {
        email,
        displayName: dto.displayName,
        role
      }
    });

    const session = await this.createSession({
      userId: user.id,
      kind: sessionKind,
      userAgent: this.getHeader(request, "user-agent"),
      ipAddress: request.ip
    });

    return {
      cookieName: SESSION_COOKIE_NAMES[sessionKind],
      cookieValue: session.rawToken,
      cookieOptions: this.getCookieOptions(session.expiresAt),
      auth: {
        user: this.toAuthenticatedUser(user),
        session: {
          id: session.id,
          kind: session.kind,
          expiresAt: session.expiresAt
        }
      }
    };
  }

  async getAuthContextFromRequest(request: AuthRequest): Promise<AuthContext | null> {
    const cookies = this.parseCookies(this.getHeader(request, "cookie"));
    const rawToken =
      cookies[SESSION_COOKIE_NAMES.admin] ??
      cookies[SESSION_COOKIE_NAMES.user] ??
      cookies[SESSION_COOKIE_NAMES.mobile];

    if (!rawToken) {
      return null;
    }

    const session = await this.prisma.session.findUnique({
      where: { sessionTokenHash: this.hashToken(rawToken) },
      include: { user: true }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return null;
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    });

    return {
      user: this.toAuthenticatedUser(session.user),
      session: {
        id: session.id,
        kind: session.kind,
        expiresAt: session.expiresAt
      }
    };
  }

  async revokeCurrentSession(request: AuthRequest) {
    const auth = request.auth ?? (await this.getAuthContextFromRequest(request));

    if (!auth) {
      return;
    }

    await this.prisma.session.update({
      where: { id: auth.session.id },
      data: { revokedAt: new Date() }
    });
  }

  getClearCookieOptions(): CookieOptions {
    return {
      ...this.getCookieOptions(new Date(0)),
      maxAge: 0
    };
  }

  getCookieNames() {
    return Object.values(SESSION_COOKIE_NAMES);
  }

  private async createSession(input: {
    userId: string;
    kind: SessionKind;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + getSessionTtlMs(input.kind));

    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        sessionTokenHash: this.hashToken(rawToken),
        expiresAt,
        userAgentHash: input.userAgent ? this.hashToken(input.userAgent) : undefined,
        ipHash: input.ipAddress ? this.hashToken(input.ipAddress) : undefined
      }
    });

    return {
      ...session,
      rawToken
    };
  }

  private getCookieOptions(expiresAt: Date): CookieOptions {
    const cookieDomain = this.configService.get<string>("AUTH_COOKIE_DOMAIN");
    const secure = this.configService.get<string>("AUTH_COOKIE_SECURE") === "true";

    return {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
      domain: cookieDomain || undefined
    };
  }

  private parseCookies(cookieHeader?: string) {
    const cookies: Record<string, string> = {};

    for (const cookie of cookieHeader?.split(";") ?? []) {
      const [name, ...valueParts] = cookie.trim().split("=");
      if (!name || valueParts.length === 0) {
        continue;
      }

      cookies[name] = decodeURIComponent(valueParts.join("="));
    }

    return cookies;
  }

  private getHeader(request: AuthRequest, name: string) {
    const value = request.headers[name] ?? request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private hashToken(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private isDevelopment() {
    return this.configService.get<string>("NODE_ENV") === "development";
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string | null;
    role: UserRole;
    homeUnitSystem: string;
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      homeUnitSystem: user.homeUnitSystem
    };
  }
}
