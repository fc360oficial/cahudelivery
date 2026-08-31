import { IsArray, IsUUID } from 'class-validator';

export class CodigosDto {
  @IsArray()
  @IsUUID('4', { each: true })
  codigos!: string[];
}
