using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RemindCount",
                table: "Requests",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "RemindedAt",
                table: "Requests",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RemindCount",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "RemindedAt",
                table: "Requests");
        }
    }
}
