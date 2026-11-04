import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, OptionalAuthGuard } from './jwt.guard';
import { LimiteAuthService } from './limite-auth.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-trocar-em-producao',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, OptionalAuthGuard, LimiteAuthService],
  exports: [AuthService, JwtModule, JwtAuthGuard, OptionalAuthGuard, LimiteAuthService],
})
export class AuthModule {}
