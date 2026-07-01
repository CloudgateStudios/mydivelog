import { SessionKind, UserRole } from "@prisma/client";
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class DevLoginDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(SessionKind)
  sessionKind?: SessionKind;
}
