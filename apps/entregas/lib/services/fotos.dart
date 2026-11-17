import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

/// Fotos tiradas pelo motorista. Ficam numa pasta do app até a fila enviar; depois são apagadas.
class Fotos {
  Fotos([ImagePicker? picker]) : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;

  /// Abre a câmera. null = o motorista cancelou.
  Future<String?> tirar() async {
    final f = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1600, maxHeight: 1600, imageQuality: 70);
    if (f == null) return null;
    final pasta = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'fotos'));
    if (!pasta.existsSync()) pasta.createSync(recursive: true);
    final destino = p.join(pasta.path, '${const Uuid().v4()}.jpg');
    await f.saveTo(destino);
    return destino;
  }

  Future<List<int>> ler(String caminho) => File(caminho).readAsBytes();

  Future<void> apagar(String caminho) async {
    final f = File(caminho);
    if (await f.exists()) await f.delete();
  }
}
