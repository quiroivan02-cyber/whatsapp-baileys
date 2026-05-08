import PDFDocument from "pdfkit-table";
import fs from "fs";
import path from "path";

/**
 * Genera un PDF a partir de los datos del inventario.
 * @param {Array} items - Lista de objetos de inventario.
 * @returns {Promise<string>} - Ruta del archivo generado.
 */
export async function generateInventoryPdf(items) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            const fileName = `Inventario_${Date.now()}.pdf`;
            const filePath = path.join(process.cwd(), fileName);
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);

            // Título del PDF
            doc.fontSize(20).text("Inventario - Indias Motos", { align: "center" });
            doc.moveDown();
            doc.fontSize(10).text(`Fecha de generación: ${new Date().toLocaleString()}`, { align: "right" });
            doc.moveDown();

            // Configuración de la tabla
            const table = {
                title: "Listado de Productos",
                headers: [
                    { label: "ID", property: "sku", width: 40 },
                    { label: "Producto", property: "nombre", width: 250 },
                    { label: "Cantidad", property: "stock", width: 80 },
                    { label: "Precio Unitario", property: "precio", width: 100, renderer: (value) => `$ ${new Intl.NumberFormat("es-CO").format(value)}` }
                ],
                datas: items.map(item => ({
                    sku: String(item.sku || ""),
                    nombre: String(item.nombre || ""),
                    stock: String(item.stock || "0"),
                    precio: item.precio || 0
                }))
            };

            // Dibujar la tabla
            doc.table(table, {
                prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
                prepareRow: (row, indexColumn, indexRow, rectRow, rectCell) => doc.font("Helvetica").fontSize(10),
            });

            doc.end();

            stream.on("finish", () => resolve(filePath));
            stream.on("error", (err) => reject(err));
        } catch (error) {
            reject(error);
        }
    });
}
