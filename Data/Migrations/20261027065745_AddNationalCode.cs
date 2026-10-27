using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNationalCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NationalCode",
                table: "People",
                type: "TEXT",
                maxLength: 10,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_People_NationalCode",
                table: "People",
                column: "NationalCode",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_People_NationalCode",
                table: "People");

            migrationBuilder.DropColumn(
                name: "NationalCode",
                table: "People");
        }
    }
}
