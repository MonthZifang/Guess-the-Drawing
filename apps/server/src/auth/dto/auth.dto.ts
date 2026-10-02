import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  avatarId?: number;
}

export class LoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
