using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEmployeePush : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "AdminUserId",
                table: "PushSubscriptions",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "INTEGER");

            migrationBuilder.AddColumn<int>(
                name: "PersonId",
                table: "PushSubscriptions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PushSubscriptions_PersonId",
                table: "PushSubscriptions",
                column: "PersonId");

            migrationBuilder.AddForeignKey(
                name: "FK_PushSubscriptions_People_PersonId",
                table: "PushSubscriptions",
                column: "PersonId",
                principalTable: "People",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PushSubscriptions_People_PersonId",
                table: "PushSubscriptions");

            migrationBuilder.DropIndex(
                name: "IX_PushSubscriptions_PersonId",
                table: "PushSubscriptions");

            migrationBuilder.DropColumn(
                name: "PersonId",
                table: "PushSubscriptions");

            migrationBuilder.AlterColumn<int>(
                name: "AdminUserId",
                table: "PushSubscriptions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "INTEGER",
                oldNullable: true);
        }
    }
}
