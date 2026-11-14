using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentClaims : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PaymentClaims",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    PersonId = table.Column<int>(type: "INTEGER", nullable: false),
                    Amount = table.Column<long>(type: "INTEGER", nullable: false),
                    PaymentCardId = table.Column<int>(type: "INTEGER", nullable: true),
                    Note = table.Column<string>(type: "TEXT", nullable: true),
                    ReceiptFile = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    ReceiptContentType = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    ReceiptBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ReviewedBy = table.Column<string>(type: "TEXT", nullable: true),
                    RejectReason = table.Column<string>(type: "TEXT", nullable: true),
                    PaymentId = table.Column<int>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentClaims", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentClaims_PaymentCards_PaymentCardId",
                        column: x => x.PaymentCardId,
                        principalTable: "PaymentCards",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PaymentClaims_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PaymentClaims_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentClaims_PaymentCardId",
                table: "PaymentClaims",
                column: "PaymentCardId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentClaims_PaymentId",
                table: "PaymentClaims",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentClaims_PersonId",
                table: "PaymentClaims",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentClaims_Status_CreatedAt",
                table: "PaymentClaims",
                columns: new[] { "Status", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaymentClaims");
        }
    }
}
