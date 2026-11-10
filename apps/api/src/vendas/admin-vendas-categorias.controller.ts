import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { CategoriaDto, criarCategoria, editarCategoria, listarCategorias } from '../admin/categorias';

/**
 * Categorias pelo painel de Vendas. São as mesmas linhas de `categorias` do Delivery (catálogo compartilhado);
 * a lógica fica em admin/categorias.ts, usada também pelas rotas de Delivery.
 */
@Controller('admin/vendas/categorias')
@UseGuards(AdminGuard)
export class AdminVendasCategoriasController {
  @Get()
  listar() {
    return listarCategorias();
  }

  @Post()
  criar(@Body() dto: CategoriaDto) {
    return criarCategoria(dto);
  }

  @Put(':id')
  editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoriaDto) {
    return editarCategoria(id, dto);
  }
}
