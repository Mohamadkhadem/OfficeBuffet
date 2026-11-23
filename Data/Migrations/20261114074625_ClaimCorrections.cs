using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class ClaimCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "EditedAt",
                table: "PaymentClaims",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EditedBy",
                table: "PaymentClaims",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "OriginalAmount",
                table: "PaymentClaims",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EditedAt",
                table: "PaymentClaims");

            migrationBuilder.DropColumn(
                name: "EditedBy",
                table: "PaymentClaims");

            migrationBuilder.DropColumn(
                name: "OriginalAmount",
                table: "PaymentClaims");
        }
    }
}
