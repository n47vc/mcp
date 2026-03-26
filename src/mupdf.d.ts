declare module 'mupdf' {
  export class Document {
    static openDocument(data: Buffer | ArrayBuffer | Uint8Array, magic: string): Document;
    countPages(): number;
    loadPage(index: number): Page;
  }

  export class Page {
    toPixmap(matrix: Matrix, colorspace: ColorSpace, alpha: boolean, showAnnotations: boolean): Pixmap;
  }

  export class Pixmap {
    asPNG(): Uint8Array;
  }

  export class Matrix {
    static scale(sx: number, sy: number): Matrix;
  }

  export class ColorSpace {
    static readonly DeviceRGB: ColorSpace;
  }
}
