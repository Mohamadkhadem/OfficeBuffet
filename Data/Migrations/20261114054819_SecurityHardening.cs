using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class SecurityHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ReceiptSha256",
                table: "PaymentClaims",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SecurityStamp",
                table: "AdminUsers",
                type: "TEXT",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "AuditLog",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    At = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Actor = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Action = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    Details = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    Ip = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLog", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentClaims_ReceiptSha256",
                table: "PaymentClaims",
                column: "ReceiptSha256");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLog_At",
                table: "AuditLog",
                column: "At");

            // The security log is append-only: the database itself refuses to change or delete an entry.
            migrationBuilder.Sql("""
                CREATE TRIGGER "AuditLog_NoUpdate" BEFORE UPDATE ON "AuditLog"
                BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
                """);
            migrationBuilder.Sql("""
                CREATE TRIGGER "AuditLog_NoDelete" BEFORE DELETE ON "AuditLog"
                BEGIN SELECT RAISE(ABORT, 'AuditLog is append-only'); END;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS \"AuditLog_NoUpdate\";");
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS \"AuditLog_NoDelete\";");
            migrationBuilder.DropTable(
                name: "AuditLog");

            migrationBuilder.DropIndex(
                name: "IX_PaymentClaims_ReceiptSha256",
                table: "PaymentClaims");

            migrationBuilder.DropColumn(
                name: "ReceiptSha256",
                table: "PaymentClaims");

            migrationBuilder.DropColumn(
                name: "SecurityStamp",
                table: "AdminUsers");
        }
    }
}
