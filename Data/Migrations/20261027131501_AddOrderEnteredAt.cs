using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOrderEnteredAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "EnteredAt",
                table: "Orders",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EnteredAt",
                table: "Orders");
        }
    }
}
