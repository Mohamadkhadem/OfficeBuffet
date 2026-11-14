using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSettlementDriveUntil : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "Until",
                table: "SettlementDrives",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UntilLabel",
                table: "SettlementDrives",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Until",
                table: "SettlementDrives");

            migrationBuilder.DropColumn(
                name: "UntilLabel",
                table: "SettlementDrives");
        }
    }
}
