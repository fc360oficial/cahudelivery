import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class CodigosDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  codigos!: string[];
}
