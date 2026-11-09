using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeBuffet.Data.Migrations
{
    /// <summary>
    /// Menu categories become their own table (with optional hours and staff group) and staff groups are added.
    /// The free-text Items.Category is carried over: the four former default categories are created first,
    /// then any other category name in use, and every item is linked to its category before the column goes.
    /// </summary>
    public partial class AddMenuCategoriesAndGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "GroupId",
                table: "People",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CategoryId",
                table: "Items",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PersonGroups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PersonGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MenuCategories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "TEXT", nullable: true),
                    EndTime = table.Column<TimeOnly>(type: "TEXT", nullable: true),
                    PersonGroupId = table.Column<int>(type: "INTEGER", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MenuCategories_PersonGroups_PersonGroupId",
                        column: x => x.PersonGroupId,
                        principalTable: "PersonGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // Carry the old free-text categories over before the column is dropped.
            migrationBuilder.Sql("""
                INSERT INTO "MenuCategories" ("Name", "SortOrder", "CreatedAt")
                VALUES ('صبحانه', 1, strftime('%Y-%m-%d %H:%M:%S', 'now')),
                       ('نوشیدنی گرم', 2, strftime('%Y-%m-%d %H:%M:%S', 'now')),
                       ('نوشیدنی سرد', 3, strftime('%Y-%m-%d %H:%M:%S', 'now')),
                       ('تنقلات', 4, strftime('%Y-%m-%d %H:%M:%S', 'now'));
                """);
            migrationBuilder.Sql("""
                INSERT INTO "MenuCategories" ("Name", "SortOrder", "CreatedAt")
                SELECT trim("Category"), 4 + ROW_NUMBER() OVER (ORDER BY MIN("Id")), strftime('%Y-%m-%d %H:%M:%S', 'now')
                FROM "Items"
                WHERE trim("Category") <> '' AND trim("Category") NOT IN (SELECT "Name" FROM "MenuCategories")
                GROUP BY trim("Category");
                """);
            migrationBuilder.Sql("""
                UPDATE "Items" SET "CategoryId" = (SELECT m."Id" FROM "MenuCategories" m WHERE m."Name" = trim("Items"."Category"));
                """);

            migrationBuilder.DropColumn(
                name: "Category",
                table: "Items");

            migrationBuilder.CreateIndex(
                name: "IX_People_GroupId",
                table: "People",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Items_CategoryId",
                table: "Items",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuCategories_Name",
                table: "MenuCategories",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MenuCategories_PersonGroupId",
                table: "MenuCategories",
                column: "PersonGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_PersonGroups_Name",
                table: "PersonGroups",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Items_MenuCategories_CategoryId",
                table: "Items",
                column: "CategoryId",
                principalTable: "MenuCategories",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_People_PersonGroups_GroupId",
                table: "People",
                column: "GroupId",
                principalTable: "PersonGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "Items",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("""
                UPDATE "Items" SET "Category" = COALESCE((SELECT m."Name" FROM "MenuCategories" m WHERE m."Id" = "Items"."CategoryId"), '');
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Items_MenuCategories_CategoryId",
                table: "Items");

            migrationBuilder.DropForeignKey(
                name: "FK_People_PersonGroups_GroupId",
                table: "People");

            migrationBuilder.DropTable(
                name: "MenuCategories");

            migrationBuilder.DropTable(
                name: "PersonGroups");

            migrationBuilder.DropIndex(
                name: "IX_People_GroupId",
                table: "People");

            migrationBuilder.DropIndex(
                name: "IX_Items_CategoryId",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "GroupId",
                table: "People");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "Items");
        }
    }
}
