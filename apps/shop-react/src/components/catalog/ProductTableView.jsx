import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";

/** @param {{ table: import("./ProductCatalog.jsx").ProductTable }} props */
export function ProductTableView({ table }) {
  return (
    <TableContainer>
      <Table size="small" data-testid="product-table">
        <TableHead>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const align = /** @type {any} */ (header.column.columnDef.meta)?.align ?? "left";
                return (
                  <TableCell key={header.id} align={align} sortDirection={sorted || false}>
                    {header.column.getCanSort() ? (
                      <TableSortLabel active={!!sorted} direction={sorted || "asc"} onClick={header.column.getToggleSortingHandler()}>
                        <table.FlexRender header={header} />
                      </TableSortLabel>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} hover>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} align={/** @type {any} */ (cell.column.columnDef.meta)?.align ?? "left"}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
