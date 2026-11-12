using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCardsOnCategoriesAndSettlementDrive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "EditedAt",
                table: "Requests",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EditedBy",
                table: "Requests",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaymentCardId",
                table: "Payments",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PantryRequestId",
                table: "Orders",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaymentCardId",
                table: "MenuCategories",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SettlementDrives",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    StartedBy = table.Column<string>(type: "TEXT", nullable: false),
                    EndedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    EndedBy = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SettlementDrives", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_PaymentCardId",
                table: "Payments",
                column: "PaymentCardId");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_PantryRequestId",
                table: "Orders",
                column: "PantryRequestId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuCategories_PaymentCardId",
                table: "MenuCategories",
                column: "PaymentCardId");

            migrationBuilder.AddForeignKey(
                name: "FK_MenuCategories_PaymentCards_PaymentCardId",
                table: "MenuCategories",
                column: "PaymentCardId",
                principalTable: "PaymentCards",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Payments_PaymentCards_PaymentCardId",
                table: "Payments",
                column: "PaymentCardId",
                principalTable: "PaymentCards",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MenuCategories_PaymentCards_PaymentCardId",
                table: "MenuCategories");

            migrationBuilder.DropForeignKey(
                name: "FK_Payments_PaymentCards_PaymentCardId",
                table: "Payments");

            migrationBuilder.DropTable(
                name: "SettlementDrives");

            migrationBuilder.DropIndex(
                name: "IX_Payments_PaymentCardId",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_Orders_PantryRequestId",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_MenuCategories_PaymentCardId",
                table: "MenuCategories");

            migrationBuilder.DropColumn(
                name: "EditedAt",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "EditedBy",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "PaymentCardId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "PantryRequestId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "PaymentCardId",
                table: "MenuCategories");
        }
    }
}
